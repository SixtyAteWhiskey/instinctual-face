import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, open, utimes } from 'node:fs/promises';
import { importDeviceProfiles, profileRoots } from '../scripts/profile-import.mjs';

const ID = 'instinct3solar45mm';
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-profile-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = path.join(directory, 'data');
  const connectIq = path.join(directory, 'SDK Manager');
  const source = path.join(connectIq, 'Devices');
  await mkdir(source, { recursive: true });
  return { directory, data, source, connectIq, target: path.join(data, 'garmin', 'devices', ID) };
}

async function profile(source, id = ID, version = 'v1') {
  const directory = path.join(source, id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'compiler.json'), JSON.stringify({ deviceId: id, deviceVersion: version }));
  await writeFile(path.join(directory, `${id}.bin`), `profile-${version}`);
  await writeFile(path.join(directory, 'simulator.json'), '{}');
  await writeFile(path.join(directory, 'device.png'), 'image placeholder');
  return directory;
}

async function font(connectIq, name, content = 'font-v1') {
  const directory = path.join(connectIq, 'Fonts');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.cft`), content);
  // Garmin's .md5 metadata is not necessarily the MD5 digest of the downloaded .cft bytes.
  await writeFile(path.join(directory, `${name}.md5`), 'a'.repeat(32));
  return directory;
}

async function assertNoStaging(data) {
  assert.ok((await readdir(path.join(data, 'garmin'))).every(name => !name.startsWith('.import-')));
  assert.ok((await readdir(path.join(data, 'garmin', 'devices'))).every(name => !name.startsWith('.import-')));
}

test('imports the shared Solar SDK profile once and excludes account files and unsupported watches', async t => {
  const env = await fixture(t);
  await profile(env.source);
  await profile(env.source, 'instinct3solar50mm');
  await profile(env.source, 'instinct');
  await writeFile(path.join(env.connectIq, 'session.json'), '{"token":"do-not-copy"}');
  const imported = await importDeviceProfiles(env.data, env.source);
  assert.deepEqual(imported, [ID]);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(await readdir(path.join(env.data, 'garmin', 'devices')), [ID]);
  assert.equal(JSON.parse(await readFile(path.join(env.target, 'compiler.json'))).deviceId, ID);
  await assert.rejects(readFile(path.join(env.data, 'garmin', 'session.json')), { code: 'ENOENT' });
  assert.deepEqual(await importDeviceProfiles(env.data, env.source), []);
  await assertNoStaging(env.data);
});

test('refreshes changed assets even when Garmin version and source timestamps stay the same', async t => {
  const env = await fixture(t);
  const source = await profile(env.source);
  await importDeviceProfiles(env.data, env.source);
  const asset = path.join(source, `${ID}.bin`);
  const before = await stat(asset);
  await writeFile(asset, 'profile-v2');
  await utimes(asset, before.atime, before.mtime);
  const imported = await importDeviceProfiles(env.data, env.source);
  assert.deepEqual(imported, [ID]);
  assert.equal(await readFile(path.join(env.target, `${ID}.bin`), 'utf8'), 'profile-v2');
  assert.equal(JSON.parse(await readFile(path.join(env.target, 'compiler.json'))).deviceVersion, 'v1');
  await assertNoStaging(env.data);
});

test('retains the last valid profile while a new download is incomplete or identifies a different watch', async t => {
  const env = await fixture(t);
  const source = await profile(env.source);
  await importDeviceProfiles(env.data, env.source);
  await rm(path.join(source, `${ID}.bin`));
  let imported = await importDeviceProfiles(env.data, env.source);
  assert.deepEqual(imported, []);
  assert.match(imported.warnings.join(' '), /incomplete.*retained/);
  assert.equal(await readFile(path.join(env.target, `${ID}.bin`), 'utf8'), 'profile-v1');
  await profile(env.source);
  await writeFile(path.join(source, 'compiler.json'), '{"deviceId":"instinct2"}');
  imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /ID does not match/);
  assert.equal(JSON.parse(await readFile(path.join(env.target, 'compiler.json'))).deviceId, ID);
  await writeFile(path.join(source, 'compiler.json'), '{');
  imported = await importDeviceProfiles(env.data, env.source);
  assert.equal(imported.length, 0);
  await assertNoStaging(env.data);
});

test('rejects symlink assets, profiles and source directories without copying private files', async t => {
  const env = await fixture(t);
  const source = await profile(env.source);
  await importDeviceProfiles(env.data, env.source);
  const secret = path.join(env.directory, 'private-token');
  await writeFile(secret, 'secret');
  await rm(path.join(source, 'device.png'));
  await symlink(secret, path.join(source, 'device.png'));
  let imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /Symbolic links/);
  assert.equal(await readFile(path.join(env.target, 'device.png'), 'utf8'), 'image placeholder');
  await rm(source, { recursive: true });
  const alternative = await profile(path.join(env.directory, 'alternative'));
  await symlink(alternative, source);
  imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /cannot be symbolic links/);
  const alias = path.join(env.directory, 'Devices-alias');
  await symlink(env.source, alias);
  imported = await importDeviceProfiles(env.data, alias);
  assert.match(imported.warnings.join(' '), /source directories cannot be symbolic links/);
  await assertNoStaging(env.data);
});

test('rejects scripts, credential entries and unsafe nested directories while preserving the cache', async t => {
  const env = await fixture(t);
  const source = await profile(env.source);
  await importDeviceProfiles(env.data, env.source);
  await writeFile(path.join(source, 'injected.js'), 'process.exit()');
  let imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /unsupported asset entries/);
  await assert.rejects(readFile(path.join(env.target, 'injected.js')), { code: 'ENOENT' });
  await rm(path.join(source, 'injected.js'));
  await mkdir(path.join(source, 'credentials'));
  await writeFile(path.join(source, 'credentials', 'image.png'), 'secret');
  imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /unsupported filename/);
  await assert.rejects(readFile(path.join(env.target, 'credentials', 'image.png')), { code: 'ENOENT' });
  await assertNoStaging(env.data);
});

test('font updates merge complete public font pairs and retain prior fonts on partial downloads', async t => {
  const env = await fixture(t);
  await profile(env.source);
  const fonts = await font(env.connectIq, 'FNT_WATCH_1');
  let imported = await importDeviceProfiles(env.data, env.source);
  assert.equal(imported.fontsUpdated, true);
  const target = path.join(env.data, 'garmin', 'fonts');
  assert.equal(await readFile(path.join(target, 'FNT_WATCH_1.cft'), 'utf8'), 'font-v1');
  await font(env.connectIq, 'FNT_WATCH_1', 'font-v2');
  imported = await importDeviceProfiles(env.data, env.source);
  assert.equal(imported.fontsUpdated, true);
  assert.equal(await readFile(path.join(target, 'FNT_WATCH_1.cft'), 'utf8'), 'font-v2');
  const other = path.join(env.directory, 'another SDK Manager');
  await mkdir(path.join(other, 'Devices'), { recursive: true });
  await font(other, 'FNT_WATCH_2', 'font-two');
  imported = await importDeviceProfiles(env.data, path.join(other, 'Devices'));
  assert.equal(imported.fontsUpdated, true);
  assert.equal(await readFile(path.join(target, 'FNT_WATCH_1.cft'), 'utf8'), 'font-v2');
  await writeFile(path.join(fonts, 'FNT_WATCH_1.cft'), 'unfinished');
  await rm(path.join(fonts, 'FNT_WATCH_1.md5'));
  imported = await importDeviceProfiles(env.data, env.source);
  assert.equal(imported.fontsUpdated, false);
  assert.match(imported.warnings.join(' '), /font download is incomplete/);
  assert.equal(await readFile(path.join(target, 'FNT_WATCH_1.cft'), 'utf8'), 'font-v2');
  await assertNoStaging(env.data);
});

test('ignores Finder metadata and rejects oversized or deeply nested asset imports before committing', async t => {
  const env = await fixture(t);
  const source = await profile(env.source);
  await writeFile(path.join(source, '.DS_Store'), 'Finder metadata');
  assert.deepEqual(await importDeviceProfiles(env.data, env.source), [ID]);
  await assert.rejects(readFile(path.join(env.target, '.DS_Store')), { code: 'ENOENT' });
  const oversized = await open(path.join(source, 'oversized.png'), 'w');
  await oversized.truncate(33 * 1024 * 1024);
  await oversized.close();
  let imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /size limit/);
  await rm(path.join(source, 'oversized.png'));
  await mkdir(path.join(source, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true });
  imported = await importDeviceProfiles(env.data, env.source);
  assert.match(imported.warnings.join(' '), /nesting limit/);
  assert.equal(await readFile(path.join(env.target, `${ID}.bin`), 'utf8'), 'profile-v1');
  await assertNoStaging(env.data);
});

test('serializes concurrent refreshes and rejects a linked destination', async t => {
  const env = await fixture(t);
  await profile(env.source);
  const imported = await Promise.all(Array.from({ length: 4 }, () => importDeviceProfiles(env.data, env.source)));
  assert.equal(imported.reduce((count, result) => count + result.length, 0), 1);
  await assertNoStaging(env.data);
  await rm(env.target, { recursive: true });
  const external = path.join(env.directory, 'other-cache');
  await mkdir(external);
  await writeFile(path.join(external, 'sentinel'), 'keep');
  await symlink(external, env.target);
  const blocked = await importDeviceProfiles(env.data, env.source);
  assert.equal(blocked.length, 0);
  assert.match(blocked.warnings.join(' '), /destination must be a regular directory/);
  assert.equal(await readFile(path.join(external, 'sentinel'), 'utf8'), 'keep');
});

test('recognizes the fixed operator-configured Docker source and normal SDK Manager roots', () => {
  const previous = process.env.GARMIN_PROFILE_SOURCE;
  const previousAppData = process.env.APPDATA;
  try {
    process.env.GARMIN_PROFILE_SOURCE = '/garmin-import/Devices';
    process.env.APPDATA = path.join(os.tmpdir(), 'garmin-test-appdata');
    const roots = profileRoots();
    assert.equal(roots[0], '/garmin-import/Devices');
    assert.ok(roots.includes(path.join(os.homedir(), '.Garmin', 'ConnectIQ', 'Devices')));
    assert.ok(roots.includes(path.join(process.env.APPDATA, 'Garmin', 'ConnectIQ', 'Devices')));
    assert.equal(roots.length, new Set(roots).size);
  } finally {
    if (previous === undefined) delete process.env.GARMIN_PROFILE_SOURCE; else process.env.GARMIN_PROFILE_SOURCE = previous;
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
  }
});
