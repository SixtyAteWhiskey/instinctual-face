import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm, stat, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { importDeviceProfiles } from './profile-import.mjs';
export { importDeviceProfiles, profileRoots } from './profile-import.mjs';

const SDK_INDEX = 'https://developer.garmin.com/downloads/connect-iq/sdks/sdks.json';
const SDK_BASE = 'https://developer.garmin.com/downloads/connect-iq/sdks/';
export const LICENSE_URL = 'https://developer.garmin.com/connect-iq/sdk/';
const MAX_DOWNLOAD = 350 * 1024 * 1024;
const MAX_ENTRIES = 20000;

async function exists(filename) { try { await stat(filename); return true; } catch { return false; } }

async function officialResponse(url) {
  for (let redirects = 0; redirects < 4; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'developer.garmin.com' ||
        !parsed.pathname.startsWith('/downloads/connect-iq/sdks/')) throw new Error('SDK downloads must come from Garmin’s official HTTPS SDK directory.');
    const response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location'), parsed).href;
      continue;
    }
    if (!response.ok) throw new Error(`Garmin SDK download returned HTTP ${response.status}. Try again or install SDK Manager manually.`);
    return response;
  }
  throw new Error('Garmin SDK download redirected too many times.');
}

/** Validate every ZIP member before extraction; reject links and traversal. */
export async function extractSdkZip(archive, directory) {
  const python = String.raw`
import pathlib, stat, sys, zipfile
archive, target = sys.argv[1:]
root = pathlib.Path(target).resolve()
with zipfile.ZipFile(archive) as package:
    entries = package.infolist()
    if len(entries) > ${MAX_ENTRIES} or sum(item.file_size for item in entries) > 1024 * 1024 * 1024:
        raise ValueError('SDK archive exceeds extraction limits')
    for item in entries:
        name = item.filename
        parts = pathlib.PurePosixPath(name).parts
        destination = (root / name).resolve()
        if '\\' in name or name.startswith('/') or '..' in parts or ':' in name or not destination.is_relative_to(root):
            raise ValueError('Unsafe SDK archive path')
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode) or item.file_size > 256 * 1024 * 1024:
            raise ValueError('Unsafe SDK archive member')
    package.extractall(root)
    for item in entries:
        destination = root / item.filename
        if destination.is_file() and (item.external_attr >> 16) & 0o111:
            destination.chmod(0o755)
`;
  await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', python, path.resolve(archive), path.resolve(directory)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60000);
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Safe SDK extraction requires Python 3: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('SDK extraction exceeded its 60-second limit.'));
      else if (code === 0) resolve();
      else reject(new Error(`SDK extraction failed: ${errors.trim()}`));
    });
  });
}

/** Download only the public SDK. Garmin device downloads require SDK Manager login. */
export async function setupGarminSdk({ dataDir = process.env.DATA_DIR ?? 'data', acceptedLicense = false, profilesPath, importProfiles = true, onProgress = () => {} } = {}) {
  if (!acceptedLicense) {
    const error = new Error(`Accept Garmin’s SDK developer agreement before downloading: ${LICENSE_URL}`);
    error.status = 400;
    throw error;
  }
  if (process.platform !== 'linux') throw new Error('Automatic SDK download currently supports Linux. Install Garmin SDK Manager for this operating system and set GARMIN_SDK_PATH.');
  const root = path.join(path.resolve(dataDir), 'garmin');
  await mkdir(root, { recursive: true });
  const sdk = path.join(root, 'sdk');
  if (!await exists(path.join(sdk, 'bin', 'monkeybrains.jar'))) {
    onProgress('Fetching Garmin’s official SDK index…');
    const response = await officialResponse(SDK_INDEX);
    const indexText = await response.text();
    if (indexText.length > 2 * 1024 * 1024) throw new Error('The Garmin SDK index exceeds its size limit.');
    const index = JSON.parse(indexText);
    if (!Array.isArray(index)) throw new Error('Garmin returned an unexpected SDK index.');
    const latest = index.filter(item => /^\d+\.\d+\.\d+$/.test(item.version ?? '') &&
      /^connectiq-sdk-lin-[A-Za-z0-9.-]+\.zip$/.test(item.linux ?? '')).sort((a, b) =>
      a.version.localeCompare(b.version, 'en', { numeric: true })).at(-1);
    if (!latest) throw new Error('No Linux SDK was found in Garmin’s official index.');
    const url = SDK_BASE + latest.linux;
    onProgress(`Downloading Connect IQ ${latest.version}…`);
    const download = await officialResponse(url);
    const length = Number(download.headers.get('content-length'));
    if (length > MAX_DOWNLOAD) throw new Error('The SDK download exceeds the 350 MiB limit.');
    const staging = await mkdtemp(path.join(root, '.sdk-download-'));
    const archive = path.join(staging, 'sdk.zip');
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      const { open } = await import('node:fs/promises');
      const file = await open(archive, 'wx', 0o600);
      try {
        for await (const chunk of download.body) {
          bytes += chunk.length;
          if (bytes > MAX_DOWNLOAD) throw new Error('The SDK download exceeds the 350 MiB limit.');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally { await file.close(); }
      const sha256 = hash.digest('hex');
      const checksum = latest.sha256 ?? latest.linuxSha256;
      if (checksum && sha256 !== checksum.toLowerCase()) throw new Error('The SDK checksum does not match Garmin’s published checksum.');
      const extracted = path.join(staging, 'extracted');
      await mkdir(extracted);
      onProgress('Validating and extracting the SDK…');
      await extractSdkZip(archive, extracted);
      if (!await exists(path.join(extracted, 'bin', 'monkeybrains.jar'))) throw new Error('The archive does not contain Garmin’s compiler.');
      await rename(extracted, sdk);
      await writeFile(path.join(root, 'sdk-download.json'), JSON.stringify({ version: latest.version, url, sha256, publishedChecksum: Boolean(checksum), downloadedAt: new Date().toISOString() }, null, 2));
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  if (importProfiles) onProgress('Looking for locally installed Instinct device profiles…');
  const imported = importProfiles ? await importDeviceProfiles(dataDir, profilesPath) : [];
  return { sdkPath: sdk, imported, licenseUrl: LICENSE_URL };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const dataDir = value('--data-dir') ?? process.env.DATA_DIR ?? 'data';
  const profilesPath = value('--profiles');
  (args.includes('--profiles-only') ? importDeviceProfiles(dataDir, profilesPath) : setupGarminSdk({
    dataDir, profilesPath, acceptedLicense: args.includes('--accept-license'), onProgress: message => console.log(message),
  })).then(result => {
    console.log(JSON.stringify(result, null, 2));
    console.log('Device profiles need a one-time Garmin SDK Manager login. After downloading your watch profile, use --profiles-only to import it.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
