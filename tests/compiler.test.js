import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';
import { createCompiler, runBounded } from '../compiler.mjs';
import { createProject } from '../web/model.js';
import { setupGarminSdk, extractSdkZip } from '../scripts/setup-garmin-sdk.mjs';
import { importDeviceProfiles } from '../scripts/profile-import.mjs';

async function fixture(t, { buildDelay = 40 } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-compiler-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sdkPath = path.join(directory, 'garmin', 'sdk');
  const devicesPath = path.join(directory, 'garmin', 'devices');
  await mkdir(path.join(sdkPath, 'bin'), { recursive: true });
  await writeFile(path.join(sdkPath, 'bin', 'monkeybrains.jar'), 'test runner placeholder');
  await writeFile(path.join(sdkPath, 'bin', 'version.txt'), 'test-sdk');
  await mkdir(path.join(devicesPath, 'instinct3solar45mm'), { recursive: true });
  // A test-only runner fixture; these files are never passed to Garmin’s compiler.
  await writeFile(path.join(devicesPath, 'instinct3solar45mm', 'compiler.json'), JSON.stringify({ deviceId: 'instinct3solar45mm' }));
  await writeFile(path.join(devicesPath, 'instinct3solar45mm', 'instinct3solar45mm.bin'), 'test profile binary');
  const control = path.join(directory, 'control');
  const events = path.join(directory, 'events');
  const javaPath = path.join(directory, 'mock compiler executable');
  await writeFile(javaPath, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('-version')) { console.error('java test runtime'); process.exit(0); }
const output = args[args.indexOf('-o')+1];
const source = args[args.indexOf('-f')+1];
if (!fs.existsSync(source)) process.exit(3);
fs.appendFileSync(${JSON.stringify(events)}, 'start\\n');
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(events)}, 'end\\n');
  if (fs.existsSync(${JSON.stringify(control)})) { console.error('test compiler diagnostic'); process.exit(2); }
  fs.writeFileSync(output, 'TEST-STUB-OUTPUT');
  console.log('test compilation complete');
}, ${buildDelay});
`, { mode: 0o700 });
  const dependencies = {
    profileImporter: async () => [],
    sdkInstaller: async ({ onProgress }) => { onProgress('Test SDK ready.'); return { sdkPath }; },
    managerPreparer: async () => ({ supported: true, installed: true, runtimeReady: true }),
    managerInspector: async () => ({ supported: true, installed: true, runtimeReady: true, reason: 'Test SDK Manager ready.' }),
    desktopInspector: async () => ({ supported: true, reason: 'Test desktop supports setup.' }),
    desktopInstaller: async () => { throw new Error('Desktop actions must be explicitly mocked in tests.'); },
    desktopManagerOpener: async () => { throw new Error('Desktop actions must be explicitly mocked in tests.'); },
    environment: { platform: 'linux', arch: 'x64', container: false },
  };
  return { directory, sdkPath, devicesPath, javaPath, control, events, ...dependencies,
    compiler: createCompiler({ dataDir: directory, sdkPath, devicesPath, javaPath, ...dependencies }) };
}

test('status distinguishes missing SDK, missing Java and per-device profiles', async t => {
  const env = await fixture(t);
  const available = await env.compiler.status();
  assert.equal(available.available, true);
  assert.equal(available.compilerReady, true);
  assert.deepEqual(available.sdkDevices, ['instinct3solar45mm']);
  assert.ok(available.devices.includes('instinct3solar50mm'));
  assert.equal(available.keyReady, false);
  const setup = await env.compiler.setup({ acceptedLicense: true });
  assert.equal(setup.setupInProgress, false);
  const missingSdk = await createCompiler({ ...env, dataDir: env.directory, sdkPath: path.join(env.directory, 'absent'), javaPath: env.javaPath }).status();
  assert.equal(missingSdk.available, false);
  assert.match(missingSdk.reason, /not installed/);
  const missingJava = await createCompiler({ ...env, dataDir: env.directory, sdkPath: env.sdkPath, javaPath: path.join(env.directory, 'missing-java') }).status();
  assert.equal(missingJava.available, false);
  assert.match(missingJava.reason, /Java/);
});

test('build orchestration creates a persistent private RSA key and cleans temporary source', async t => {
  const env = await fixture(t);
  const project = createProject('minimal', 'instinct3solar50mm');
  project.name = 'Test face $(echo injected)';
  const result = await env.compiler.build(project);
  assert.equal(result.device, 'instinct3solar50mm');
  assert.equal(result.sdkDevice, 'instinct3solar45mm');
  assert.match(result.filename, /^test-face-echo-injected-instinct3solar50mm\.prg$/);
  assert.equal(result.bytes.toString(), 'TEST-STUB-OUTPUT');
  assert.match(result.diagnostics, /test compilation complete/);
  const filename = path.join(env.directory, 'private', 'developer_key.der');
  const keyBytes = await readFile(filename);
  assert.equal(createPrivateKey({ key: keyBytes, format: 'der', type: 'pkcs8' }).asymmetricKeyDetails.modulusLength, 4096);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(filename))).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(path.join(env.directory, 'builds')), []);
  await env.compiler.build(project);
  assert.deepEqual(await readFile(filename), keyBytes);
});

test('build validation rejects unsupported targets before invoking a command', async t => {
  const env = await fixture(t);
  await assert.rejects(env.compiler.build({ ...createProject(), device: '../injected' }), error => error.status === 400);
  await assert.rejects(env.compiler.build(createProject('summit', 'instinct2')), error => error.status === 503 && /profile is missing/.test(error.message));
  await assert.rejects(readFile(env.events), error => error.code === 'ENOENT');
});

test('compiler errors carry diagnostics and cleanup still happens', async t => {
  const env = await fixture(t);
  await writeFile(env.control, 'fail');
  await assert.rejects(env.compiler.build(createProject('summit', 'instinct3solar45mm')), error =>
    error.status === 422 && /test compiler diagnostic/.test(error.diagnostics));
  assert.deepEqual(await readdir(path.join(env.directory, 'builds')), []);
});

test('builds are serialized and the waiting queue is bounded', async t => {
  const env = await fixture(t);
  const compiler = createCompiler({ ...env, dataDir: env.directory, maxQueue: 2 });
  const project = createProject('minimal', 'instinct3solar45mm');
  const first = compiler.build(project);
  const second = compiler.build(project);
  await assert.rejects(compiler.build(project), error => error.status === 429);
  await Promise.all([first, second]);
  assert.equal(await readFile(env.events, 'utf8'), 'start\nend\nstart\nend\n');
});

test('process timeout and diagnostic limits prevent unbounded compiler work', async () => {
  await assert.rejects(runBounded(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 30 }), error => error.status === 504);
  const result = await runBounded(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { logLimit: 1000 });
  assert.equal(result.code, 0);
  assert.ok(result.diagnostics.length < 1100);
  assert.match(result.diagnostics, /truncated/);
});

test('SDK setup requires explicit license acceptance before network work', async () => {
  await assert.rejects(setupGarminSdk(), error => error.status === 400 && /agreement/.test(error.message));
});

test('SDK extraction rejects traversal and symbolic links before writing files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-sdk-zip-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const zip = path.join(directory, 'bad.zip');
  await runBounded('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('../outside.txt', 'unsafe')`, zip]);
  await assert.rejects(extractSdkZip(zip, path.join(directory, 'output')), /Unsafe SDK archive path/);
  await assert.rejects(readFile(path.join(directory, 'outside.txt')), error => error.code === 'ENOENT');
  await runBounded('python3', ['-c', `import zipfile,sys,stat
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 i=zipfile.ZipInfo('link');i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'/etc/passwd')`, zip]);
  await assert.rejects(extractSdkZip(zip, path.join(directory, 'output')), /Unsafe SDK archive member/);
});

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Test operation did not reach its expected state.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('status imports new profiles automatically with a ten-second throttle and each build rechecks them', async t => {
  const env = await fixture(t);
  await rm(env.devicesPath, { recursive: true });
  const source = path.join(env.directory, 'host', 'Devices');
  const profile = path.join(source, 'instinct3solar45mm');
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'compiler.json'), '{"deviceId":"instinct3solar45mm"}');
  const binary = path.join(profile, 'instinct3solar45mm.bin');
  await writeFile(binary, 'profile-v1');
  let clock = 0, imports = 0;
  const compiler = createCompiler({ ...env, dataDir: env.directory, devicesPath: source, now: () => clock,
    profileImporter: async (...args) => { imports++; return importDeviceProfiles(...args); } });
  const ready = await compiler.status();
  assert.ok(ready.devices.includes('instinct3solar50mm'));
  assert.equal(ready.sdkInstalled, true);
  assert.equal(imports, 1);
  await writeFile(binary, 'profile-v2');
  clock = 9999;
  await compiler.status();
  assert.equal(imports, 1);
  assert.equal(await readFile(path.join(env.devicesPath, 'instinct3solar45mm', 'instinct3solar45mm.bin'), 'utf8'), 'profile-v1');
  clock = 10000;
  await compiler.status();
  assert.equal(imports, 2);
  assert.equal(await readFile(path.join(env.devicesPath, 'instinct3solar45mm', 'instinct3solar45mm.bin'), 'utf8'), 'profile-v2');
  await compiler.build(createProject('minimal', 'instinct3solar50mm'));
  assert.equal(imports, 3);
});

test('readiness uses only validated cached profiles and never compiles directly from external SDK Manager files', async t => {
  const env = await fixture(t);
  const external = path.join(env.directory, 'external', 'Devices');
  await mkdir(path.join(external, 'instinct2'), { recursive: true });
  await writeFile(path.join(external, 'instinct2', 'compiler.json'), '{"deviceId":"instinct2"}');
  await writeFile(path.join(external, 'instinct2', 'instinct2.bin'), 'unimported profile');
  let passedSource;
  const compiler = createCompiler({ ...env, dataDir: env.directory, devicesPath: external,
    profileImporter: async (data, source) => { assert.equal(data, env.directory); passedSource = source; return []; } });
  const initial = await compiler.status();
  assert.equal(passedSource, external);
  assert.deepEqual(initial.sdkDevices, ['instinct3solar45mm']);
  await assert.rejects(compiler.build(createProject('minimal', 'instinct2')), error => error.status === 503);
  await writeFile(path.join(env.devicesPath, 'instinct3solar45mm', 'compiler.json'), '{"deviceId":"instinct2"}');
  assert.deepEqual((await compiler.refreshProfiles()).sdkDevices, []);
  await writeFile(path.join(env.devicesPath, 'instinct3solar45mm', 'compiler.json'), '{"deviceId":"instinct3solar45mm"}');
  await writeFile(path.join(env.devicesPath, 'instinct3solar45mm', 'instinct3solar45mm.bin'), '');
  assert.deepEqual((await compiler.refreshProfiles()).sdkDevices, []);
});

test('imports, refreshes, setup and builds share a queue while busy status returns a snapshot immediately', async t => {
  const env = await fixture(t, { buildDelay: 150 });
  const steps = [];
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    profileImporter: async () => {
      let events = '';
      try { events = await readFile(env.events, 'utf8'); } catch {}
      assert.ok(!events.endsWith('start\n'), 'Import must not replace files while a build is running.');
      steps.push('import');
      return [];
    },
    sdkInstaller: async () => { assert.equal(await readFile(env.events, 'utf8'), 'start\nend\n'); steps.push('sdk'); },
    managerPreparer: async () => { steps.push('manager'); },
  });
  await compiler.status();
  const building = compiler.build(createProject('minimal', 'instinct3solar45mm'));
  await waitFor(async () => { try { return await readFile(env.events, 'utf8') === 'start\n'; } catch { return false; } });
  const refreshing = compiler.refreshProfiles();
  const settingUp = compiler.setup({ acceptedLicense: true });
  const duringBuild = await compiler.status();
  assert.equal(duringBuild.available, true);
  assert.equal(duringBuild.operationInProgress, 'build');
  assert.equal(duringBuild.setupInProgress, true);
  assert.deepEqual(steps, ['import', 'import']);
  await Promise.all([building, refreshing, settingUp]);
  assert.deepEqual(steps, ['import', 'import', 'import', 'sdk', 'import', 'manager']);
  assert.equal((await compiler.status()).setupInProgress, false);
});

test('setup exposes progress during SDK and SDK Manager downloads without invoking desktop privileges or a GUI', async t => {
  const env = await fixture(t);
  const sdkGate = deferred(), managerGate = deferred();
  let sdkStarted = false, managerStarted = false;
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    sdkInstaller: async options => {
      assert.deepEqual(Object.keys(options).sort(), ['acceptedLicense', 'dataDir', 'onProgress', 'profilesPath']);
      assert.equal(options.acceptedLicense, true);
      sdkStarted = true;
      options.onProgress('Downloading SDK test package…');
      await sdkGate.promise;
    },
    managerPreparer: async options => {
      assert.deepEqual(Object.keys(options).sort(), ['acceptedLicense', 'dataDir', 'onProgress']);
      managerStarted = true;
      options.onProgress('Downloading SDK Manager test package…');
      await managerGate.promise;
    },
  });
  const settingUp = compiler.setup({ acceptedLicense: true });
  assert.equal(compiler.setup({ acceptedLicense: true }), settingUp);
  await waitFor(() => sdkStarted);
  let status = await compiler.status();
  assert.equal(status.setupInProgress, true);
  assert.equal(status.setupProgress, 'Downloading SDK test package…');
  sdkGate.resolve();
  await waitFor(() => managerStarted);
  status = await compiler.status();
  assert.equal(status.available, true);
  assert.equal(status.setupProgress, 'Downloading SDK Manager test package…');
  managerGate.resolve();
  status = await settingUp;
  assert.equal(status.setupInProgress, false);
  assert.equal(status.setupError, null);
  assert.match(status.setupCommand, /setup:desktop.*--data-dir '/);
  assert.match(status.setupProgress, /complete/);
});

test('SDK Manager failure surfaces an actionable error and keeps the working compiler SDK', async t => {
  const env = await fixture(t);
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    managerPreparer: async () => { throw new Error('Official download is temporarily unavailable.'); } });
  await assert.rejects(compiler.setup({ acceptedLicense: true }), error => error.status === 503 && /compiler SDK is installed.*Set up & open Garmin/.test(error.message));
  const status = await compiler.status();
  assert.equal(status.setupInProgress, false);
  assert.equal(status.available, true);
  assert.equal(status.compilerReady, true);
  assert.match(status.setupError, /SDK Manager preparation failed/);
  assert.equal((await compiler.build(createProject('minimal', 'instinct3solar45mm'))).sdkDevice, 'instinct3solar45mm');
});

test('profile warnings are surfaced while previously imported valid profiles remain usable', async t => {
  const env = await fixture(t);
  const warning = 'instinct3solar45mm: Download incomplete. The previous profile was retained.';
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    profileImporter: async () => { const result = []; result.warnings = [warning]; return result; } });
  const status = await compiler.status();
  assert.equal(status.compilerReady, true);
  assert.deepEqual(status.profileWarnings, [warning]);
  await compiler.build(createProject('minimal', 'instinct3solar45mm'));
});

test('container setup prepares only the compiler and unsupported desktop platforms get clear setup guidance', async t => {
  const env = await fixture(t);
  let installedSdk = 0;
  const disallowedManager = async () => { throw new Error('Docker must not prepare or inspect SDK Manager.'); };
  const container = createCompiler({ ...env, dataDir: env.directory,
    environment: { platform: 'linux', arch: 'x64', container: true },
    sdkInstaller: async () => { installedSdk++; }, managerPreparer: disallowedManager, managerInspector: disallowedManager });
  const ready = await container.setup({ acceptedLicense: true });
  assert.equal(installedSdk, 1);
  assert.deepEqual(ready.environment, { platform: 'linux', arch: 'x64', container: true });
  assert.equal(ready.sdkManager.supported, false);
  assert.match(ready.sdkManager.reason, /read-only into Docker/);
  const unsupported = createCompiler({ ...env, dataDir: env.directory,
    environment: { platform: 'darwin', arch: 'arm64', container: false },
    sdkInstaller: async () => { installedSdk++; } });
  await assert.rejects(unsupported.setup({ acceptedLicense: true }), error => error.status === 400 && /supports Linux.*your operating system/.test(error.message));
  assert.equal(installedSdk, 1);
});

test('desktop SDK preparation can skip profile mutations while the running app owns automatic imports', async t => {
  const env = await fixture(t);
  const source = path.join(env.directory, 'desktop', 'Devices');
  await mkdir(path.join(source, 'instinct2'), { recursive: true });
  await writeFile(path.join(source, 'instinct2', 'compiler.json'), '{"deviceId":"instinct2"}');
  await writeFile(path.join(source, 'instinct2', 'instinct2.bin'), 'test profile');
  const skipped = await setupGarminSdk({ dataDir: env.directory, acceptedLicense: true, profilesPath: source, importProfiles: false });
  assert.deepEqual(skipped.imported, []);
  await assert.rejects(readFile(path.join(env.devicesPath, 'instinct2', 'compiler.json')), { code: 'ENOENT' });
  const normal = await setupGarminSdk({ dataDir: env.directory, acceptedLicense: true, profilesPath: source });
  assert.deepEqual(normal.imported, ['instinct2']);
});

test('one-click desktop setup shares the compiler queue, exposes progress, and deduplicates retries', async t => {
  const env = await fixture(t, { buildDelay: 120 });
  const gate = deferred();
  let started = false, setups = 0;
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    desktopInstaller: async options => {
      setups++;
      assert.equal(await readFile(env.events, 'utf8'), 'start\nend\n', 'Desktop setup must wait for a build.');
      assert.deepEqual(Object.keys(options).sort(), ['acceptedLicense', 'dataDir', 'onProgress']);
      assert.equal(options.acceptedLicense, true);
      options.onProgress('Waiting for administrator approval…');
      started = true;
      await gate.promise;
      options.onProgress('Garmin SDK Manager opened.');
    },
  });
  await compiler.status();
  const building = compiler.build(createProject('minimal', 'instinct3solar45mm'));
  const settingUp = compiler.setupDesktop({ acceptedLicense: true });
  assert.equal(compiler.setupDesktop({ acceptedLicense: true }), settingUp);
  assert.equal((await compiler.status()).setupInProgress, true);
  await building;
  await waitFor(() => started);
  const busy = await compiler.status();
  assert.equal(busy.operationInProgress, 'desktop setup');
  assert.match(busy.setupProgress, /administrator approval/);
  await assert.rejects(compiler.openSdkManager(), error => error.status === 409);
  gate.resolve();
  const ready = await settingUp;
  assert.equal(ready.setupInProgress, false);
  assert.equal(ready.desktopSetupSupported, true);
  assert.equal(setups, 1);
});

test('desktop setup requires explicit license and capability while opening installed Manager does not', async t => {
  const env = await fixture(t);
  let opened = 0, installed = 0;
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    desktopInstaller: async () => { installed++; }, desktopManagerOpener: async () => { opened++; },
  });
  await assert.rejects(compiler.setupDesktop(), error => error.status === 400 && /agreement/.test(error.message));
  await compiler.openSdkManager();
  assert.equal(opened, 1);
  assert.equal(installed, 0);
  const noDesktop = createCompiler({ ...env, dataDir: env.directory,
    desktopInspector: async () => ({ supported: false, reason: 'This is a headless server.' }),
    desktopInstaller: async () => assert.fail('Must not install on headless servers.'),
  });
  await assert.rejects(noDesktop.setupDesktop({ acceptedLicense: true }), error => error.status === 400 && /headless/.test(error.message));
  assert.equal((await noDesktop.status()).desktopSetupSupported, false);
  const docker = createCompiler({ ...env, dataDir: env.directory, environment: { platform: 'linux', arch: 'x64', container: true } });
  await assert.rejects(docker.setupDesktop({ acceptedLicense: true }), error => error.status === 400 && /outside Docker/.test(error.message));
});

test('desktop cancellation keeps the existing compiler available and permits a safe retry', async t => {
  const env = await fixture(t);
  let attempts = 0;
  const compiler = createCompiler({ ...env, dataDir: env.directory,
    desktopInstaller: async () => { if (++attempts === 1) throw new Error('Administrator approval was cancelled.'); },
  });
  await assert.rejects(compiler.setupDesktop({ acceptedLicense: true }), error => error.status === 503 && /cancelled/.test(error.message));
  const status = await compiler.status();
  assert.equal(status.setupInProgress, false);
  assert.equal(status.compilerReady, true);
  assert.match(status.setupError, /cancelled/);
  const retry = await compiler.setupDesktop({ acceptedLicense: true });
  assert.equal(retry.setupError, null);
  assert.equal(retry.compilerReady, true);
});
