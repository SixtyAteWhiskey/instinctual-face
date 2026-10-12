import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { lstat, mkdir, opendir, open, rename, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEVICES } from '../web/devices.js';

const PROFILE_IDS = [...new Set(Object.values(DEVICES).map(device => device.id))];
const IMPORT_QUEUES = new Map();
const PROFILE_LIMITS = { files: 1024, bytes: 128 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, depth: 5 };
const FONT_LIMITS = { files: 8192, bytes: 512 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, depth: 5 };
const PRIVATE_NAME = /(?:^|[._ -])(?:account|auth|cookie|credential|credentials|login|password|session|token)(?:[._ -]|$)/i;

/** Fixed, local SDK Manager asset locations. GARMIN_PROFILE_SOURCE is an operator setting, never request input. */
export function profileRoots() {
  const home = os.homedir();
  return [...new Set([
    process.env.GARMIN_PROFILE_SOURCE,
    path.join(home, '.Garmin', 'ConnectIQ', 'Devices'),
    path.join(home, 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Devices'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'Garmin', 'ConnectIQ', 'Devices')] : []),
  ].filter(Boolean).map(directory => path.resolve(directory)))];
}

async function optionalStat(filename) {
  try { return await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensureDirectory(directory) {
  const info = await optionalStat(directory);
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The asset destination must be a regular directory.');
  } else await mkdir(directory, { recursive: true });
}

function publicFile(relative, kind, id) {
  const basename = path.basename(relative);
  if (PRIVATE_NAME.test(basename)) return false;
  if (kind === 'fonts') return /^FNT_[A-Za-z0-9_.-]+\.(?:cft|md5)$/i.test(basename);
  return basename === 'compiler.json' || basename === 'simulator.json' || basename === 'personality.mss' ||
    basename === `${id}.bin` || basename === `${id}.api.debug.xml` || basename === `${id}.api.xml` ||
    /\.(?:png|svg|jpe?g|bmp)$/i.test(basename);
}

function sameStat(a, b) {
  return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Walk only regular assets. Links, sockets, devices and executable/script entries never enter the cache. */
async function snapshot(directory, kind, id) {
  const limits = kind === 'fonts' ? FONT_LIMITS : PROFILE_LIMITS;
  const rootInfo = await optionalStat(directory);
  if (!rootInfo) return null;
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Asset directories cannot be symbolic links.');
  const files = [];
  let bytes = 0;
  let entryCount = 0;
  async function walk(relative = '', depth = 0) {
    if (depth > limits.depth) throw new Error('Asset directories exceed the nesting limit.');
    const entries = [];
    for await (const entry of await opendir(path.join(directory, relative))) {
      if (entry.name === '.DS_Store') continue;
      if (++entryCount > limits.files + 128) throw new Error('The download exceeds the asset entry limit.');
      entries.push(entry.name);
    }
    for (const name of entries.sort()) {
      // Finder metadata is not an SDK asset, and is never copied.
      if (name === '.DS_Store') continue;
      if (!name || name.length > 180 || name.startsWith('.') || PRIVATE_NAME.test(name) || /[\x00-\x1f\x7f\\:]/.test(name)) throw new Error('An asset has an unsupported filename.');
      const child = path.join(relative, name);
      const info = await lstat(path.join(directory, child));
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not permitted in imported assets.');
      if (info.isDirectory()) { await walk(child, depth + 1); continue; }
      if (!info.isFile() || !publicFile(child, kind, id)) throw new Error('The download contains unsupported asset entries.');
      if (info.size === 0 || info.size > limits.fileBytes) throw new Error('An asset is empty or exceeds the file size limit.');
      bytes += info.size;
      if (files.length >= limits.files || bytes > limits.bytes) throw new Error('The download exceeds asset import limits.');
      files.push({ relative: child, info });
    }
  }
  await walk();
  return files;
}

async function assetBytes(directory, entry) {
  const file = await open(path.join(directory, entry.relative), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || !sameStat(before, entry.info)) throw new Error('The download changed while it was being imported.');
    const bytes = await file.readFile();
    const after = await file.stat();
    if (!sameStat(before, after) || bytes.length !== entry.info.size) throw new Error('The download changed while it was being imported.');
    return bytes;
  } finally { await file.close(); }
}

async function inspectAssets(directory, kind, id) {
  const files = await snapshot(directory, kind, id);
  if (!files) return null;
  const hash = createHash('sha256');
  const inspected = [];
  for (const entry of files) {
    const bytes = await assetBytes(directory, entry);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    hash.update(JSON.stringify([entry.relative.split(path.sep).join('/'), bytes.length, sha256]));
    inspected.push({ ...entry, sha256 });
    if (kind === 'profile' && ['compiler.json', 'simulator.json'].includes(entry.relative)) {
      if (bytes.length > 2 * 1024 * 1024) throw new Error('A profile JSON document exceeds its size limit.');
      let json;
      try { json = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('A profile JSON document is incomplete or invalid.'); }
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('A profile JSON document is invalid.');
      if (entry.relative === 'compiler.json' && json.deviceId !== id) throw new Error('The device profile ID does not match its directory.');
    }
    if (kind === 'fonts' && /\.md5$/i.test(entry.relative) && !/^[a-f0-9]{32}\s*$/i.test(bytes.toString('utf8'))) throw new Error('A font checksum document is incomplete.');
  }
  const names = new Set(inspected.map(entry => entry.relative));
  if (kind === 'profile' && (!names.has('compiler.json') || !names.has(`${id}.bin`))) throw new Error('The device profile download is incomplete.');
  if (kind === 'fonts') {
    for (const name of names) {
      const paired = name.replace(/\.(?:cft|md5)$/i, /\.cft$/i.test(name) ? '.md5' : '.cft');
      if (!names.has(paired)) throw new Error('A font download is incomplete.');
    }
  }
  const after = await snapshot(directory, kind, id);
  if (!after || after.length !== inspected.length || after.some((entry, index) => entry.relative !== inspected[index].relative || !sameStat(entry.info, inspected[index].info))) {
    throw new Error('The download changed while it was being imported.');
  }
  return { directory, files: inspected, fingerprint: hash.digest('hex') };
}

async function copyInspected(assets, destination) {
  for (const entry of assets.files) {
    const bytes = await assetBytes(assets.directory, entry);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('The download changed while it was being imported.');
    const filename = path.join(destination, entry.relative);
    await mkdir(path.dirname(filename), { recursive: true });
    const output = await open(filename, 'w', 0o644);
    try { await output.writeFile(bytes); } finally { await output.close(); }
  }
}

/** Commit a fully validated directory, keeping the previous copy until the rename succeeds. */
async function replaceDirectory(staging, destination) {
  const previous = await optionalStat(destination);
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error('The asset destination must be a regular directory.');
  const backup = `${staging}.previous`;
  let movedPrevious = false;
  try {
    if (previous) { await rename(destination, backup); movedPrevious = true; }
    await rename(staging, destination);
  } catch (error) {
    if (movedPrevious) await rename(backup, destination);
    throw error;
  }
  if (movedPrevious) await rm(backup, { recursive: true, force: true });
}

async function runImport(dataDir, sourceDirectory) {
  const root = path.join(dataDir, 'garmin');
  const destination = path.join(root, 'devices');
  await ensureDirectory(dataDir);
  await ensureDirectory(root);
  await ensureDirectory(destination);
  const candidates = sourceDirectory ? [path.resolve(sourceDirectory)] : profileRoots();
  const sources = [];
  const imported = [];
  Object.defineProperties(imported, { warnings: { value: [], writable: true }, fontsUpdated: { value: false, writable: true } });
  for (const candidate of candidates) {
    try {
      const info = await optionalStat(candidate);
      if (!info) continue;
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Profile source directories cannot be symbolic links.');
      sources.push(candidate);
    } catch (error) { imported.warnings.push(error.message); }
  }
  for (const id of PROFILE_IDS) {
    for (const source of sources) {
      const profile = path.join(source, id);
      const target = path.join(destination, id);
      if (path.resolve(profile) === path.resolve(target)) continue;
      let assets;
      try {
        assets = await inspectAssets(profile, 'profile', id);
        if (!assets) continue;
        let existing;
        try { existing = await inspectAssets(target, 'profile', id); } catch { /* Replace a damaged regular cache with validated source assets. */ }
        if (existing?.fingerprint === assets.fingerprint) break;
        const staging = await mkdtemp(path.join(destination, `.import-${id}-`));
        try {
          await copyInspected(assets, staging);
          await replaceDirectory(staging, target);
          imported.push(id);
        } finally { await rm(staging, { recursive: true, force: true }); }
        break;
      } catch (error) {
        imported.warnings.push(`${id}: ${error.message} The previous profile was retained.`);
      }
    }
  }
  // Fonts are a public asset cache shared by all downloaded devices. Merge complete font sets;
  // retaining prior fonts lets watches downloaded through different SDK Manager installs coexist.
  for (const source of sources) {
    const fonts = path.join(path.dirname(source), 'Fonts');
    const target = path.join(root, 'fonts');
    if (path.resolve(fonts) === path.resolve(target)) continue;
    try {
      const incoming = await inspectAssets(fonts, 'fonts');
      if (!incoming || !incoming.files.length) continue;
      const existing = await inspectAssets(target, 'fonts');
      const oldHashes = new Map(existing?.files.map(entry => [entry.relative, entry.sha256]) ?? []);
      if (incoming.files.every(entry => oldHashes.get(entry.relative) === entry.sha256)) continue;
      const staging = await mkdtemp(path.join(root, '.import-fonts-'));
      try {
        if (existing) await copyInspected(existing, staging);
        await copyInspected(incoming, staging);
        // The merged tree is subject to the same count/size limits as each incoming tree.
        await inspectAssets(staging, 'fonts');
        await replaceDirectory(staging, target);
        imported.fontsUpdated = true;
      } finally { await rm(staging, { recursive: true, force: true }); }
    } catch (error) {
      imported.warnings.push(`Fonts: ${error.message} The previous fonts were retained.`);
    }
  }
  imported.warnings = [...new Set(imported.warnings)];
  return imported;
}

/** Import only supported public device/font assets, including later SDK Manager updates. */
export function importDeviceProfiles(dataDir, sourceDirectory) {
  const directory = path.resolve(dataDir);
  const previous = IMPORT_QUEUES.get(directory) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(() => runImport(directory, sourceDirectory));
  const queued = work.finally(() => { if (IMPORT_QUEUES.get(directory) === queued) IMPORT_QUEUES.delete(directory); });
  IMPORT_QUEUES.set(directory, queued);
  return queued;
}
