import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, access, mkdtemp, open, realpath, readlink, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { extractSdkZip, LICENSE_URL } from './setup-garmin-sdk.mjs';

export const SDK_MANAGER_URL = 'https://developer.garmin.com/downloads/connect-iq/sdk-manager/connectiq-sdk-manager-linux.zip';
const KEYRING = '/usr/share/keyrings/ubuntu-archive-keyring.gpg';
const UBUNTU_ARCHIVE = 'https://archive.ubuntu.com/ubuntu/';
const RUNTIME_PACKAGES = ['libicu70', 'libjavascriptcoregtk-4.0-18', 'libwebkit2gtk-4.0-37'];
const HELPERS = ['/usr/lib/x86_64-linux-gnu/webkit2gtk-4.0/WebKitNetworkProcess', '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.0/WebKitWebProcess'];
const MANAGER_RESOURCES = ['share/sdkmanager/connectiq-icon.png', 'share/sdkmanager/acknowledgements.html', 'share/sdkmanager/changes.html'];
const MAX_DOWNLOAD = 250 * 1024 * 1024;
const downloads = new Map();

function managerPaths(dataDir) {
  const root = path.join(path.resolve(dataDir), 'garmin');
  const directory = path.join(root, 'sdk-manager');
  return { root, directory, binary: path.join(directory, 'bin', 'sdkmanager'), runtime: path.join(directory, 'runtime') };
}
async function regularFile(filename) {
  try { return (await lstat(filename)).isFile(); } catch { return false; }
}
async function executable(filename) {
  if (!await regularFile(filename)) return false;
  try { await access(filename, constants.X_OK); return true; } catch { return false; }
}

/** Commands always use argument arrays; output and execution time are bounded. */
async function run(command, args, { timeout = 60000, cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    const append = (kind, chunk) => {
      if (kind === 'stdout') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 2 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(new Error(`${command} is unavailable: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} exceeded its ${Math.round(timeout / 1000)}-second limit.`));
      else if (overflow) reject(new Error(`${command} returned too much output.`));
      else resolve({ code, stdout, stderr });
    });
  });
}

export function parseOsRelease(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s#]*))$/.exec(line.trim());
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4];
  }
  return values;
}
export function runtimeInstallSupported(osRelease, platform = process.platform, arch = process.arch) {
  return platform === 'linux' && arch === 'x64' && (
    osRelease.ID === 'ubuntu' && ['22.04', '24.04'].includes(osRelease.VERSION_ID) ||
    osRelease.ID === 'linuxmint' && ['jammy', 'noble'].includes(osRelease.UBUNTU_CODENAME)
  );
}
function commandQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

export async function inspectSdkManager({ dataDir = process.env.DATA_DIR ?? 'data' } = {}) {
  const paths = managerPaths(dataDir);
  const supported = process.platform === 'linux' && process.arch === 'x64';
  let release = {};
  try { release = parseOsRelease(await readFile('/etc/os-release', 'utf8')); } catch {}
  const binaryPresent = await executable(paths.binary);
  const missingResources = binaryPresent ? (await Promise.all(MANAGER_RESOURCES.map(async resource => await regularFile(path.join(paths.directory, resource)) ? null : resource))).filter(Boolean) : [];
  const installed = binaryPresent && !missingResources.length;
  const status = {
    supported, installed, runtimeReady: false, binaryPath: paths.binary,
    missingLibraries: [], missingHelpers: [], missingResources,
    dependencyInstallSupported: runtimeInstallSupported(release),
    setupCommand: `node scripts/setup-sdk-manager.mjs --accept-license --install-dependencies --launch --data-dir ${commandQuote(path.resolve(dataDir))}`,
    reason: '',
  };
  if (!supported) { status.reason = 'Automatic SDK Manager setup supports Linux x86-64 desktops. Use Garmin’s SDK Manager download for your operating system.'; return status; }
  if (!installed) { status.reason = binaryPresent ? 'SDK Manager’s installation is incomplete. Run setup to repair it.' : 'Garmin SDK Manager has not been downloaded yet.'; return status; }
  try {
    const result = await run('/usr/bin/ldd', [paths.binary]);
    status.missingLibraries = [...new Set([...`${result.stdout}\n${result.stderr}`.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map(match => match[1]))];
    status.missingHelpers = (await Promise.all(HELPERS.map(async helper => await executable(helper) ? null : path.basename(helper)))).filter(Boolean);
    status.runtimeReady = result.code === 0 && !status.missingLibraries.length && !status.missingHelpers.length;
    status.reason = status.runtimeReady ? 'SDK Manager is ready. Sign in in Garmin’s window and download your watch’s device profile.' : 'SDK Manager needs Linux desktop libraries before it can open.';
    if (result.code !== 0 && !status.missingLibraries.length) status.reason = 'The downloaded SDK Manager could not be inspected with ldd. Install Garmin’s desktop runtime manually.';
  } catch (error) { status.reason = error.message; }
  return status;
}

export function isManagerDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'developer.garmin.com' && !url.username && !url.password && !url.port && url.pathname === new URL(SDK_MANAGER_URL).pathname && !url.search;
  } catch { return false; }
}
async function officialResponse(url, validUrl) {
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!validUrl(url)) throw new Error('Download URL is outside the allowed official HTTPS directory.');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.get('location')) throw new Error('Official download returned a redirect without a destination.');
      url = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) throw new Error(`Official download returned HTTP ${response.status}. Try again later.`);
    return response;
  }
  throw new Error('Official download redirected too many times.');
}
async function downloadToFile(url, filename, validUrl) {
  const response = await officialResponse(url, validUrl);
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) throw new Error('Download exceeds the 250 MiB limit.');
  if (!response.body) throw new Error('Official download returned an empty response.');
  const file = await open(filename, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) throw new Error('Download exceeds the 250 MiB limit.');
      hash.update(chunk);
      await file.writeFile(chunk);
    }
  } finally { await file.close(); }
  if (!bytes) throw new Error('Official download returned an empty file.');
  return { bytes, sha256: hash.digest('hex') };
}

/** Download preparation never requests privileges or opens a desktop window. */
export async function prepareSdkManager({ dataDir = process.env.DATA_DIR ?? 'data', acceptedLicense = false, onProgress = () => {} } = {}) {
  const current = await inspectSdkManager({ dataDir });
  if (current.installed) return current;
  if (acceptedLicense !== true) {
    const error = new Error(`Accept Garmin’s developer agreement before downloading SDK Manager: ${LICENSE_URL}`);
    error.status = 400;
    throw error;
  }
  if (!current.supported) throw new Error(current.reason);
  const paths = managerPaths(dataDir);
  if (downloads.has(paths.directory)) return downloads.get(paths.directory);
  const task = (async () => {
    await mkdir(paths.root, { recursive: true });
    const staging = await mkdtemp(path.join(paths.root, '.manager-download-'));
    try {
      onProgress('Downloading Garmin’s official Linux SDK Manager…');
      const downloaded = await downloadToFile(SDK_MANAGER_URL, path.join(staging, 'manager.zip'), isManagerDownloadUrl);
      const extracted = path.join(staging, 'extracted');
      await mkdir(extracted);
      onProgress('Validating and extracting SDK Manager…');
      await extractSdkZip(path.join(staging, 'manager.zip'), extracted);
      if (!await executable(path.join(extracted, 'bin', 'sdkmanager')) || !(await Promise.all(MANAGER_RESOURCES.map(resource => regularFile(path.join(extracted, resource))))).every(Boolean)) {
        throw new Error('The official archive does not contain the complete expected SDK Manager and its resources.');
      }
      // Staging and installation live on the same filesystem. The executable
      // becomes visible only together with all its resources, never mid-copy.
      let recoveryDirectory, previousDirectory, previousExists = false;
      try {
        await lstat(paths.directory);
        previousExists = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (previousExists) {
        recoveryDirectory = await mkdtemp(path.join(paths.root, '.sdk-manager-recovery-'));
        previousDirectory = path.join(recoveryDirectory, 'sdk-manager');
        try { await rename(paths.directory, previousDirectory); }
        catch (error) { await rm(recoveryDirectory, { recursive: true, force: true }); throw error; }
      }
      try { await rename(extracted, paths.directory); }
      catch (error) {
        if (previousDirectory) {
          try { await rename(previousDirectory, paths.directory); await rm(recoveryDirectory, { recursive: true, force: true }); }
          catch { throw new Error(`SDK Manager installation failed. Your previous files remain preserved at ${previousDirectory}: ${error.message}`); }
        }
        throw error;
      }
      if (previousDirectory) onProgress(`Preserved the incomplete previous installation at ${previousDirectory}.`);
      await writeFile(path.join(paths.root, 'sdk-manager-download.json'), JSON.stringify({ url: SDK_MANAGER_URL, ...downloaded, downloadedAt: new Date().toISOString() }, null, 2));
      return inspectSdkManager({ dataDir });
    } finally { await rm(staging, { recursive: true, force: true }); }
  })();
  downloads.set(paths.directory, task);
  try { return await task; } finally { downloads.delete(paths.directory); }
}

/** Extract only the expected signed APT record, rejecting unsafe filenames. */
export function parsePackageMetadata(text, expectedPackage, expectedVersion) {
  if (!RUNTIME_PACKAGES.includes(expectedPackage)) throw new Error('Unexpected runtime package.');
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    const values = Object.fromEntries(paragraph.split('\n').filter(line => /^[A-Za-z0-9-]+: /.test(line)).map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
    if (values.Package !== expectedPackage || values.Version !== expectedVersion || values.Architecture !== 'amd64') continue;
    if (!/^[a-f0-9]{64}$/i.test(values.SHA256 ?? '') || !/^pool\/[A-Za-z0-9_+./~:-]+\.deb$/.test(values.Filename ?? '') || values.Filename.split('/').includes('..') || !/^\d+$/.test(values.Size ?? '') || !Number.isSafeInteger(Number(values.Size)) || Number(values.Size) <= 0 || Number(values.Size) > MAX_DOWNLOAD) throw new Error('Signed APT package metadata contains an invalid checksum, filename, or size.');
    return { package: values.Package, version: values.Version, architecture: 'amd64', sha256: values.SHA256.toLowerCase(), size: Number(values.Size), filename: values.Filename };
  }
  throw new Error(`The signed Ubuntu index did not contain ${expectedPackage} ${expectedVersion}.`);
}
function aptConfig(directory) {
  const q = value => JSON.stringify(value);
  return `Dir::Etc::parts "-";\nDir::Etc::main "-";\nDir::Etc::sourcelist ${q(path.join(directory, 'sources.list'))};\nDir::Etc::sourceparts "-";\nDir::Etc::preferences "-";\nDir::Etc::preferencesparts "-";\nDir::State::lists ${q(path.join(directory, 'lists'))};\nDir::Cache::archives ${q(path.join(directory, 'archives'))};\nDir::Cache::pkgcache ${q(path.join(directory, 'pkgcache.bin'))};\nDir::Cache::srcpkgcache ${q(path.join(directory, 'srcpkgcache.bin'))};\nAPT::Architecture "amd64";\nAPT::Architectures { "amd64"; };\nAPT::Get::List-Cleanup "false";\nAcquire::Languages "none";\nAcquire::AllowInsecureRepositories "false";\nAcquire::AllowDowngradeToInsecureRepositories "false";\nAPT::Update::Error-Mode "any";\nAcquire::Retries "1";\nAcquire::https::Timeout "30";\n`;
}
function ubuntuPackageUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://archive.ubuntu.com' && url.pathname.startsWith('/ubuntu/pool/') && !url.username && !url.password && !url.search;
  } catch { return false; }
}
async function fileChecksum(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size > MAX_DOWNLOAD) throw new Error('Runtime package cache contains an unsafe file.');
  const hash = createHash('sha256');
  const file = await open(filename, 'r');
  try { for await (const chunk of file.createReadStream()) hash.update(chunk); } finally { await file.close(); }
  return hash.digest('hex');
}

async function downloadRuntime({ dataDir, onProgress }) {
  const status = await inspectSdkManager({ dataDir });
  if (!status.dependencyInstallSupported) throw new Error('Automatic desktop libraries support Ubuntu 22.04/24.04 and their Linux Mint equivalents on x86-64. Install SDK Manager dependencies manually on this system.');
  if (!await regularFile(KEYRING)) throw new Error('Ubuntu’s archive signing keyring is missing. Install ubuntu-keyring using your operating system’s package manager.');
  const paths = managerPaths(dataDir);
  await mkdir(paths.runtime, { recursive: true });
  const temporary = await mkdtemp(path.join(paths.runtime, '.signed-apt-'));
  const cache = path.join(paths.runtime, 'apt');
  await mkdir(cache, { recursive: true });
  try {
    for (const name of ['lists/partial', 'archives/partial']) await mkdir(path.join(temporary, name), { recursive: true });
    await writeFile(path.join(temporary, 'sources.list'), ['jammy', 'jammy-security', 'jammy-updates'].map(suite => `deb [arch=amd64 signed-by=${KEYRING}] ${UBUNTU_ARCHIVE} ${suite} main`).join('\n') + '\n');
    const config = path.join(temporary, 'apt.conf');
    await writeFile(config, aptConfig(temporary));
    onProgress('Checking Ubuntu’s signed package indexes in an isolated local directory…');
    // APT_CONFIG is read before APT's system defaults, so default hooks and
    // repositories cannot leak into this isolated metadata-only invocation.
    const aptEnv = { ...process.env, APT_CONFIG: config };
    const update = await run('/usr/bin/apt-get', ['-c', config, 'update'], { timeout: 180000, env: aptEnv });
    if (update.code !== 0) throw new Error(`Could not verify Ubuntu’s signed package index. ${update.stderr.slice(-2000).trim()}`);
    const packages = [];
    for (const name of RUNTIME_PACKAGES) {
      const policy = await run('/usr/bin/apt-cache', ['-c', config, 'policy', name], { env: aptEnv });
      const version = /^\s*Candidate:\s*(\S+)$/m.exec(policy.stdout)?.[1];
      if (policy.code !== 0 || !version || version === '(none)' || !/^[A-Za-z0-9.+:~_-]+$/.test(version)) throw new Error(`Ubuntu’s signed index has no suitable ${name} package.`);
      const show = await run('/usr/bin/apt-cache', ['-c', config, 'show', `${name}=${version}`], { env: aptEnv });
      if (show.code !== 0) throw new Error(`Could not read the signed package metadata for ${name}.`);
      const record = parsePackageMetadata(show.stdout, name, version);
      const filename = path.join(cache, path.basename(record.filename));
      let cached = false;
      if (await regularFile(filename)) cached = await fileChecksum(filename) === record.sha256;
      if (!cached) {
        onProgress(`Downloading verified ${name} ${version}…`);
        const partial = path.join(temporary, `${name}.deb`);
        const downloaded = await downloadToFile(UBUNTU_ARCHIVE + record.filename, partial, ubuntuPackageUrl);
        if (downloaded.sha256 !== record.sha256 || downloaded.bytes !== record.size) throw new Error(`The ${name} package does not match Ubuntu’s signed checksum and size.`);
        await rename(partial, filename);
      }
      const fields = await run('/usr/bin/dpkg-deb', ['--field', filename, 'Package', 'Version', 'Architecture']);
      if (fields.code !== 0 || !fields.stdout.includes(`Package: ${name}\n`) || !fields.stdout.includes(`Version: ${version}\n`) || !fields.stdout.includes('Architecture: amd64\n')) throw new Error(`The ${name} package identity does not match Ubuntu’s signed index.`);
      packages.push({ ...record, file: filename, verifiedAgainstSignedAptMetadata: true });
    }
    await writeFile(path.join(paths.runtime, 'verified-packages.json'), JSON.stringify({ keyring: KEYRING, verifiedAt: new Date().toISOString(), packages }, null, 2));
    return packages;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

// These fixed desktop actions may only be used by the local CLI or the server's
// loopback, same-origin desktop endpoints. They never accept commands from HTTP.
export async function ensureBuildTools({ dataDir, onProgress }) {
  const status = await inspectSdkManager({ dataDir });
  if (!status.dependencyInstallSupported) throw new Error('Automatic desktop dependencies support Ubuntu 22.04/24.04 and their Linux Mint equivalents on x86-64.');
  const packages = [];
  try {
    const java = await run('java', ['-version']);
    const version = /version "(?:1\.)?(\d+)/.exec(`${java.stdout}\n${java.stderr}`);
    if (java.code !== 0 || !version || Number(version[1]) < 11) packages.push('openjdk-17-jre-headless');
  } catch { packages.push('openjdk-17-jre-headless'); }
  try {
    const python = await run('python3', ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)']);
    if (python.code !== 0) packages.push('python3');
  } catch { packages.push('python3'); }
  const certificates = await run('/usr/bin/dpkg-query', ['--show', '--showformat=${Status}', 'ca-certificates']);
  if (certificates.code !== 0 || certificates.stdout.trim() !== 'install ok installed') packages.push('ca-certificates');
  // WebKit 4.0 uses libsoup 2, while modern Ubuntu's WebKit 4.1 uses libsoup 3.
  // Both are available in the current host repositories and can coexist.
  if (!status.runtimeReady) {
    for (const name of ['libsecret-1-0', 'libsoup-2.4-1']) {
      const installed = await run('/usr/bin/dpkg-query', ['--show', '--showformat=${Status}', `${name}:amd64`]);
      if (installed.code !== 0 || installed.stdout.trim() !== 'install ok installed') packages.push(`${name}:amd64`);
    }
  }
  if (!packages.length) { onProgress('Java, Python 3, and HTTPS certificates are ready.'); return; }
  onProgress(`Administrator authorization will appear to install build prerequisites from your operating system’s configured repositories: ${packages.join(', ')}.`);
  const result = await run('/usr/bin/pkexec', ['/usr/bin/apt-get', '--no-remove', '--no-upgrade', 'install', '-y', '--no-install-recommends', ...packages], { timeout: 180000 });
  if (result.code !== 0) throw new Error(`Build prerequisite installation was cancelled or failed. ${result.stderr.slice(-3000).trim()} If your package cache is stale, refresh it in your operating system’s Update Manager and retry.`);
}
export async function installRuntime({ dataDir, onProgress }) {
  const current = await inspectSdkManager({ dataDir });
  if (current.runtimeReady) { onProgress('SDK Manager’s desktop libraries are already installed.'); return current; }
  const packages = await downloadRuntime({ dataDir, onProgress });
  const install = [];
  for (const item of packages) {
    const installed = await run('/usr/bin/dpkg-query', ['--show', '--showformat=${Status}\t${Version}\n', item.package]);
    const match = /^install ok installed\t(\S+)/m.exec(installed.stdout);
    if (match) {
      const newer = await run('/usr/bin/dpkg', ['--compare-versions', match[1], 'gt', item.version]);
      if (newer.code === 0) throw new Error(`A newer ${item.package} is already installed. Setup will not downgrade it; install SDK Manager’s remaining libraries with your operating system’s package manager.`);
      if (match[1] === item.version) continue;
    }
    install.push(item.file);
  }
  if (!install.length) throw new Error(`The verified WebKit libraries are installed, but SDK Manager still lacks ${[...current.missingLibraries, ...current.missingHelpers].join(', ') || 'a working runtime'}. Use your operating system’s package manager to repair the desktop runtime.`);
  onProgress('Approve the administrator prompt on your desktop to install SDK Manager’s verified Ubuntu libraries.');
  // Polkit handles credentials itself. No passwords are requested or stored here.
  const result = await run('/usr/bin/pkexec', ['/usr/bin/dpkg', '--refuse-downgrade', '--install', ...install], { timeout: 180000 });
  if (result.code !== 0) throw new Error(`Desktop library installation was cancelled or failed. ${result.stderr.slice(-3000).trim()}`);
  const ready = await inspectSdkManager({ dataDir });
  if (!ready.runtimeReady) throw new Error(`Libraries were installed, but SDK Manager still needs ${[...ready.missingLibraries, ...ready.missingHelpers].join(', ') || 'additional desktop dependencies'}. Install those through your operating system’s package manager.`);
  return ready;
}
async function managerProcessIds(uid) {
  const result = await run('/usr/bin/pgrep', ['-x', '-u', String(uid), 'sdkmanager'], { timeout: 5000 });
  if (result.code !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(value => /^[1-9]\d{0,9}$/.test(value)).slice(0, 1000);
}

async function managerProcess(pid) {
  const directory = `/proc/${pid}`;
  const [owner, comm, executable] = await Promise.all([
    stat(directory), readFile(path.join(directory, 'comm'), 'utf8'), readlink(path.join(directory, 'exe')),
  ]);
  return { uid: owner.uid, comm: comm.trim(), executable };
}

/** Only the same user's exact installed executable qualifies as already open. */
export async function isSdkManagerRunning(binaryPath, {
  uid = process.getuid?.(), listProcesses = managerProcessIds,
  readProcess = managerProcess, resolveBinary = realpath,
} = {}) {
  if (!Number.isInteger(uid) || uid < 0) return false;
  let expected, pids;
  try { expected = await resolveBinary(binaryPath); pids = await listProcesses(uid); }
  catch { return false; }
  if (!Array.isArray(pids)) return false;
  for (const pid of pids.slice(0, 1000)) {
    if (!/^[1-9]\d{0,9}$/.test(String(pid))) continue;
    try {
      const record = await readProcess(String(pid));
      if (record.uid === uid && record.comm === 'sdkmanager' && record.executable === expected) return true;
    } catch { /* A process may exit between discovery and inspection. */ }
  }
  return false;
}

export async function launchManager(status, { runningInspector = isSdkManagerRunning } = {}) {
  if (!status.runtimeReady) throw new Error(`${status.reason} Choose Set up & open Garmin to repair the desktop dependencies.`);
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('SDK Manager needs a desktop display on this computer, outside Docker or a headless server.');
  const managerAlreadyRunning = async () => {
    try { return await runningInspector(status.binaryPath) === true; } catch { return false; }
  };
  if (await managerAlreadyRunning()) return { alreadyOpen: true };
  return new Promise((resolve, reject) => {
    const child = spawn(status.binaryPath, [], { cwd: path.dirname(status.binaryPath), detached: true, stdio: 'ignore', shell: false });
    let timer;
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      // A single-instance manager may hand control to its existing window and
      // exit successfully. Immediate runtime/display failures must be reported.
      if (code === 0) resolve({ alreadyOpen: false });
      // Garmin exits 255 for a second instance. Do not ignore that code unless
      // the exact installed executable has actually appeared under this user.
      else if (code === 255 && await managerAlreadyRunning()) resolve({ alreadyOpen: true });
      else reject(new Error(`Garmin SDK Manager could not open (${signal || `exit ${code}`}). Check this desktop's display permissions and SDK Manager libraries, then retry.`));
    });
    child.once('spawn', () => {
      timer = setTimeout(() => { child.unref(); resolve({ alreadyOpen: false }); }, 750);
    });
  });
}

export function parseManagerArgs(args) {
  const result = { dataDir: process.env.DATA_DIR ?? 'data', acceptedLicense: false, installDependencies: false, launch: false, check: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--data-dir') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--data-dir requires a directory.');
      result.dataDir = args[++index];
    } else if (argument === '--accept-license') result.acceptedLicense = true;
    else if (argument === '--install-dependencies') result.installDependencies = true;
    else if (argument === '--launch') result.launch = true;
    else if (argument === '--check') result.check = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown SDK Manager setup option: ${argument}`);
  }
  if (result.check && (result.installDependencies || result.launch)) throw new Error('--check only inspects readiness; use setup flags separately.');
  return result;
}
async function main() {
  const options = parseManagerArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Install Garmin SDK Manager on a Linux x86-64 desktop:\n  node scripts/setup-sdk-manager.mjs --accept-license --install-dependencies --launch\n\n--accept-license accepts Garmin’s agreement: ${LICENSE_URL}\n--install-dependencies permits desktop administrator prompts for missing Java, Python, desktop dependencies, and verified Ubuntu WebKit 4.0 libraries.\n--launch opens Garmin’s window for your sign-in and device-profile download.\n--check only reports installed files and runtime readiness.\n--data-dir DIRECTORY selects this app’s private data folder.\nNo Garmin credentials are read or stored by this script.`);
    return;
  }
  const onProgress = message => console.log(message);
  if (options.installDependencies && !(await inspectSdkManager(options)).installed && !options.acceptedLicense) {
    throw new Error(`Accept Garmin’s developer agreement before SDK Manager setup: ${LICENSE_URL}`);
  }
  if (options.installDependencies) await ensureBuildTools({ ...options, onProgress });
  let status = options.check ? await inspectSdkManager(options) : await prepareSdkManager({ ...options, onProgress });
  if (options.installDependencies) status = await installRuntime({ ...options, onProgress });
  console.log(JSON.stringify(status, null, 2));
  if (options.launch) {
    const launched = await launchManager(status);
    console.log(launched.alreadyOpen ? 'SDK Manager is already open. Switch to its desktop window, sign in if needed, and download your watch profile in Devices.' : 'SDK Manager opened. Sign in there, then download your watch profile in Devices.');
  }
  if (options.check && !status.runtimeReady) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
