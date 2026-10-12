import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  SDK_MANAGER_URL, inspectSdkManager, prepareSdkManager, isManagerDownloadUrl,
  parsePackageMetadata, parseOsRelease, runtimeInstallSupported, parseManagerArgs,
  launchManager, isSdkManagerRunning,
} from '../scripts/setup-sdk-manager.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinct-manager-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function archiveFixture(directory, entries) {
  const filename = path.join(directory, 'fixture.zip');
  const result = spawnSync('python3', ['-c', `import json, sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as archive:\n for name, content in json.loads(sys.argv[2]):\n  info = zipfile.ZipInfo(name)\n  info.external_attr = 0o100755 << 16\n  archive.writestr(info, content)`, filename, JSON.stringify(entries)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return readFile(filename);
}
const linuxDesktop = process.platform === 'linux' && process.arch === 'x64';
const managerEntries = (binary = '#!/bin/sh\nexit 0\n') => [['bin/sdkmanager', binary], ['share/sdkmanager/connectiq-icon.png', 'icon fixture'], ['share/sdkmanager/acknowledgements.html', 'license fixture'], ['share/sdkmanager/changes.html', 'changes fixture']];

test('manager archive permits only Garmin’s exact official HTTPS URL', () => {
  assert.equal(isManagerDownloadUrl(SDK_MANAGER_URL), true);
  for (const url of [SDK_MANAGER_URL.replace('https:', 'http:'), SDK_MANAGER_URL.replace('developer.garmin.com', 'garmin.example.com'), `${SDK_MANAGER_URL}?command=evil`, SDK_MANAGER_URL.replace('/sdk-manager/', '/sdks/'), SDK_MANAGER_URL.replace('https://', 'https://user:password@'), SDK_MANAGER_URL.replace('https://developer.garmin.com', 'https://developer.garmin.com:8443')]) assert.equal(isManagerDownloadUrl(url), false, url);
});

test('Ubuntu and Mint dependency checks reject unrelated distributions and architectures', () => {
  const mint = parseOsRelease('ID=linuxmint\nVERSION_ID="22.3"\nUBUNTU_CODENAME=noble\nPRETTY_NAME="Linux Mint 22.3"\n');
  assert.equal(mint.VERSION_ID, '22.3');
  assert.equal(runtimeInstallSupported(mint, 'linux', 'x64'), true);
  assert.equal(runtimeInstallSupported({ ID: 'ubuntu', VERSION_ID: '24.04' }, 'linux', 'x64'), true);
  assert.equal(runtimeInstallSupported({ ID: 'ubuntu', VERSION_ID: '22.04' }, 'linux', 'x64'), true);
  for (const [release, platform, arch] of [[{ ID: 'debian', VERSION_ID: '12' }, 'linux', 'x64'], [{ ID: 'ubuntu', VERSION_ID: '24.04' }, 'linux', 'arm64'], [mint, 'darwin', 'x64'], [{ ID: 'ubuntu', VERSION_ID: '20.04' }, 'linux', 'x64'], [{ ID: 'linuxmint', UBUNTU_CODENAME: 'unknown' }, 'linux', 'x64']]) assert.equal(runtimeInstallSupported(release, platform, arch), false);
});

test('signed Ubuntu package metadata enforces package identity, architecture, hash, size, and safe pool paths', () => {
  const record = 'Package: libicu70\nVersion: 70.1-2\nArchitecture: amd64\nFilename: pool/main/i/icu/libicu70_70.1-2_amd64.deb\nSize: 1234\nSHA256: ' + 'a'.repeat(64) + '\n';
  assert.deepEqual(parsePackageMetadata(record, 'libicu70', '70.1-2'), { package: 'libicu70', version: '70.1-2', architecture: 'amd64', filename: 'pool/main/i/icu/libicu70_70.1-2_amd64.deb', size: 1234, sha256: 'a'.repeat(64) });
  assert.throws(() => parsePackageMetadata(record, 'unexpected-package', '70.1-2'), /Unexpected/);
  assert.throws(() => parsePackageMetadata(record, 'libicu70', 'wrong-version'), /did not contain/);
  for (const mutation of [record.replace('Architecture: amd64', 'Architecture: arm64'), record.replace('pool/main/i/icu/', 'pool/../../'), record.replace('pool/main/i/icu/', 'https://evil.example/'), record.replace('Size: 1234', 'Size: NaN'), record.replace('Size: 1234', 'Size: 9999999999'), record.replace('SHA256: ' + 'a'.repeat(64), 'SHA256: badhash')]) assert.throws(() => parsePackageMetadata(mutation, 'libicu70', '70.1-2'));
});

test('CLI requires explicit installation permission and keeps readiness checks read only', () => {
  const options = parseManagerArgs(['--accept-license', '--install-dependencies', '--launch', '--data-dir', '/tmp/a space']);
  assert.equal(options.acceptedLicense, true);
  assert.equal(options.installDependencies, true);
  assert.equal(options.launch, true);
  assert.equal(options.dataDir, '/tmp/a space');
  assert.equal(parseManagerArgs(['--check']).installDependencies, false);
  assert.throws(() => parseManagerArgs(['--check', '--install-dependencies']), /only inspects/);
  assert.throws(() => parseManagerArgs(['--check', '--launch']), /only inspects/);
  assert.throws(() => parseManagerArgs(['--data-dir']), /requires a directory/);
  assert.throws(() => parseManagerArgs(['--run', 'bad command']), /Unknown/);
});

test('inspection does not create files and refuses a symlink as a manager executable', async t => {
  const directory = await temporary(t);
  const status = await inspectSdkManager({ dataDir: directory });
  assert.equal(status.installed, false);
  assert.equal(status.runtimeReady, false);
  assert.deepEqual(await readdir(directory), []);
  await mkdir(path.join(directory, 'garmin/sdk-manager/bin'), { recursive: true });
  await symlink('/usr/bin/true', path.join(directory, 'garmin/sdk-manager/bin/sdkmanager'));
  assert.equal((await inspectSdkManager({ dataDir: directory })).installed, false);
});

test('desktop launching reports an immediate runtime failure rather than claiming a window opened', { skip: !linuxDesktop || !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY }, async () => {
  // These fixed system test executables never create a Garmin window.
  await assert.rejects(launchManager({ runtimeReady: true, binaryPath: '/usr/bin/false' }), /could not open.*exit 1/);
  await launchManager({ runtimeReady: true, binaryPath: '/usr/bin/true' });
  await assert.rejects(launchManager({ runtimeReady: false, reason: 'Missing libraries.' }), /Set up & open Garmin/);
});

test('already-open detection requires the same user, exact comm and exact installed executable', async () => {
  const expected = '/private/garmin/sdk-manager/bin/sdkmanager';
  const base = { uid: 1000, resolveBinary: async binary => { assert.equal(binary, expected); return expected; },
    listProcesses: async uid => { assert.equal(uid, 1000); return ['123', 'invalid', '../456']; },
    readProcess: async pid => { assert.equal(pid, '123'); return { uid: 1000, comm: 'sdkmanager', executable: expected }; },
  };
  assert.equal(await isSdkManagerRunning(expected, base), true);
  for (const record of [{ uid: 1001, comm: 'sdkmanager', executable: expected }, { uid: 1000, comm: 'another-app', executable: expected }, { uid: 1000, comm: 'sdkmanager', executable: '/other/sdkmanager' }, { uid: 1000, comm: 'sdkmanager', executable: `${expected} (deleted)` }]) {
    assert.equal(await isSdkManagerRunning(expected, { ...base, readProcess: async () => record }), false);
  }
  assert.equal(await isSdkManagerRunning(expected, { ...base, readProcess: async () => { throw new Error('Process ended.'); } }), false);
  assert.equal(await isSdkManagerRunning(expected, { ...base, listProcesses: async () => { throw new Error('Process list unavailable.'); } }), false);
});

test('an already-open matching Manager is reused rather than spawning another instance', { skip: !linuxDesktop || !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY }, async () => {
  const result = await launchManager({ runtimeReady: true, binaryPath: '/not/a/real/manager' },
    { runningInspector: async binary => { assert.equal(binary, '/not/a/real/manager'); return true; } });
  assert.deepEqual(result, { alreadyOpen: true });
});

test('exit 255 is accepted only when the exact existing Manager is independently confirmed', { skip: !linuxDesktop || !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY }, async t => {
  const directory = await temporary(t);
  const binary = path.join(directory, 'instance-test');
  await writeFile(binary, '#!/bin/sh\nexit 255\n', { mode: 0o755 });
  await assert.rejects(launchManager({ runtimeReady: true, binaryPath: binary }, { runningInspector: async () => false }), /could not open.*exit 255/);
  let checks = 0;
  const result = await launchManager({ runtimeReady: true, binaryPath: binary }, { runningInspector: async () => ++checks > 1 });
  assert.deepEqual(result, { alreadyOpen: true });
  assert.equal(checks, 2);
});

test('missing SDK Manager requires literal license acceptance before any download', async t => {
  const directory = await temporary(t);
  for (const acceptedLicense of [false, undefined, 'false', 1]) await assert.rejects(prepareSdkManager({ dataDir: directory, acceptedLicense }), /Accept Garmin/);
  assert.deepEqual(await readdir(directory), []);
});

test('download prepares only the official archive and preserves provenance', { skip: !linuxDesktop }, async t => {
  const directory = await temporary(t);
  const archive = await archiveFixture(directory, managerEntries());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(archive, { headers: { 'content-length': String(archive.length) } }); };
  const status = await prepareSdkManager({ dataDir: directory, acceptedLicense: true });
  assert.equal(status.installed, true);
  assert.equal(status.runtimeReady, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SDK_MANAGER_URL);
  assert.equal(calls[0].options.redirect, 'manual');
  const provenance = JSON.parse(await readFile(path.join(directory, 'garmin/sdk-manager-download.json'), 'utf8'));
  assert.equal(provenance.url, SDK_MANAGER_URL);
  assert.equal(provenance.bytes, archive.length);
  assert.match(provenance.sha256, /^[a-f0-9]{64}$/);
  const again = await prepareSdkManager({ dataDir: directory });
  assert.equal(again.installed, true);
  assert.equal(calls.length, 1, 'existing manager does not redownload');
  assert.ok(!(await readdir(path.join(directory, 'garmin'))).some(name => name.startsWith('.manager-download-')));
});

test('manager download rejects off-site redirects and removes temporary files', { skip: !linuxDesktop }, async t => {
  const directory = await temporary(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'https://evil.example/manager.zip' } });
  await assert.rejects(prepareSdkManager({ dataDir: directory, acceptedLicense: true }), /outside the allowed/);
  assert.deepEqual(await readdir(path.join(directory, 'garmin')), []);
});

test('manager download rejects ZIP traversal before installing any files', { skip: !linuxDesktop }, async t => {
  const directory = await temporary(t);
  const archive = await archiveFixture(directory, [['../escape.txt', 'bad'], ['bin/sdkmanager', '#!/bin/sh\nexit 0\n']]);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(archive);
  await assert.rejects(prepareSdkManager({ dataDir: directory, acceptedLicense: true }), /Unsafe SDK archive path/);
  assert.deepEqual(await readdir(path.join(directory, 'garmin')), []);
});

test('manager archives missing resources are rejected without publishing an executable', { skip: !linuxDesktop }, async t => {
  const directory = await temporary(t);
  const archive = await archiveFixture(directory, [['bin/sdkmanager', '#!/bin/sh\nexit 0\n']]);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(archive);
  await assert.rejects(prepareSdkManager({ dataDir: directory, acceptedLicense: true }), /complete expected SDK Manager/);
  assert.equal((await inspectSdkManager({ dataDir: directory })).installed, false);
  assert.deepEqual(await readdir(path.join(directory, 'garmin')), []);
});

test('partial installations are replaced atomically and their previous files remain recoverable', { skip: !linuxDesktop }, async t => {
  const directory = await temporary(t);
  const manager = path.join(directory, 'garmin/sdk-manager');
  await mkdir(path.join(manager, 'bin'), { recursive: true });
  await writeFile(path.join(manager, 'bin/sdkmanager'), '#!/bin/sh\n# original partial executable\n', { mode: 0o755 });
  await mkdir(path.join(manager, 'runtime/apt'), { recursive: true });
  await writeFile(path.join(manager, 'runtime/apt/original-cache.txt'), 'keep this original cache');
  const partial = await inspectSdkManager({ dataDir: directory });
  assert.equal(partial.installed, false);
  assert.equal(partial.missingResources.length, 3);
  assert.match(partial.reason, /incomplete/);
  const archive = await archiveFixture(directory, managerEntries());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(archive);
  const progress = [];
  const repaired = await prepareSdkManager({ dataDir: directory, acceptedLicense: true, onProgress: message => progress.push(message) });
  assert.equal(repaired.installed, true);
  assert.deepEqual(repaired.missingResources, []);
  assert.equal(await readFile(path.join(manager, 'bin/sdkmanager'), 'utf8'), '#!/bin/sh\nexit 0\n');
  const roots = await readdir(path.join(directory, 'garmin'));
  const recovery = roots.filter(name => name.startsWith('.sdk-manager-recovery-'));
  assert.equal(recovery.length, 1);
  const previous = path.join(directory, 'garmin', recovery[0], 'sdk-manager');
  assert.equal(await readFile(path.join(previous, 'runtime/apt/original-cache.txt'), 'utf8'), 'keep this original cache');
  assert.match(await readFile(path.join(previous, 'bin/sdkmanager'), 'utf8'), /original partial executable/);
  assert.ok(progress.some(message => message.includes(previous)));
  assert.ok(!roots.some(name => name.startsWith('.manager-download-')));
});
