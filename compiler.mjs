import path from 'node:path';
import { mkdir, readFile, writeFile, stat, lstat, chmod, mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeProject } from './web/model.js';
import { DEVICES } from './web/devices.js';
import { generateGarminFiles } from './web/garmin-export.js';
import { setupGarminSdk, LICENSE_URL } from './scripts/setup-garmin-sdk.mjs';
import { importDeviceProfiles } from './scripts/profile-import.mjs';
import { prepareSdkManager, inspectSdkManager } from './scripts/setup-sdk-manager.mjs';
import { inspectDesktopSetup, setupDesktop, openDesktopManager } from './scripts/setup-desktop.mjs';

const keyPair = promisify(generateKeyPair);
const LOG_LIMIT = 32 * 1024;
const MAX_PRG = 8 * 1024 * 1024;

export class CompilerError extends Error {
  constructor(message, status = 422, diagnostics = '') {
    super(message);
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

async function exists(filename) { try { await stat(filename); return true; } catch { return false; } }

/** All commands are argument arrays; design contents never become shell commands. */
export function runBounded(command, args, { cwd, timeout = 90000, logLimit = LOG_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '', length = 0, truncated = false, timedOut = false;
    const collect = chunk => {
      if (length >= logLimit) { truncated = true; return; }
      const part = chunk.subarray(0, logLimit - length);
      output += part.toString('utf8');
      length += part.length;
      if (part.length < chunk.length) truncated = true;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const diagnostics = output + (truncated ? '\n[Compiler output truncated]\n' : '');
      if (timedOut) reject(new CompilerError('Compilation timed out. Try a simpler layout or check the server’s Java runtime.', 504, diagnostics));
      else resolve({ code, diagnostics });
    });
  });
}

export function createCompiler({
  dataDir = process.env.DATA_DIR ?? 'data',
  sdkPath = process.env.GARMIN_SDK_PATH,
  devicesPath = process.env.GARMIN_DEVICES_PATH,
  javaPath = process.env.JAVA_PATH ?? 'java',
  timeout = 90000,
  maxQueue = 4,
  profileImporter = importDeviceProfiles,
  sdkInstaller = setupGarminSdk,
  managerPreparer = prepareSdkManager,
  managerInspector = inspectSdkManager,
  desktopInspector = inspectDesktopSetup,
  desktopInstaller = setupDesktop,
  desktopManagerOpener = openDesktopManager,
  now = Date.now,
  environment = { platform: process.platform, arch: process.arch, container: process.env.INSTINCTUAL_FACE_CONTAINER === '1' },
} = {}) {
  const data = path.resolve(dataDir);
  const root = path.join(data, 'garmin');
  const sdk = path.resolve(sdkPath ?? path.join(root, 'sdk'));
  const jar = path.join(sdk, 'bin', 'monkeybrains.jar');
  const keyFile = path.join(data, 'private', 'developer_key.der');
  const compilerHome = path.join(root, 'compiler-home');
  const quotedData = `'${data.replaceAll("'", "'\\''")}'`;
  const setupCommand = `npm run setup:desktop -- --accept-license --install-dependencies --launch --data-dir ${quotedData}`;
  const nativeManagerSupported = environment.platform === 'linux' && environment.arch === 'x64' && !environment.container;
  let queue = Promise.resolve(), pendingCount = 0, activeOperation = null, setupPromise, setupOperation;
  let lastProfileSync = -Infinity, profileWarnings = [], installed = new Map();
  let setupProgress = '', setupError = null;
  let snapshot = {
    sdkInstalled: false, sdkVersion: null, devices: [], sdkDevices: [], keyReady: false,
    available: false, compilerReady: false, reason: 'Checking compiler readiness…',
    sdkManager: { supported: nativeManagerSupported, installed: false, runtimeReady: false, reason: 'SDK Manager readiness has not been checked yet.' },
    desktopSetupSupported: false, desktopSetupReason: 'Checking desktop setup capability…',
  };

  function readinessSnapshot() {
    return structuredClone({ ...snapshot, setupInProgress: Boolean(setupPromise), setupProgress, setupError,
      profileWarnings, environment, licenseUrl: LICENSE_URL, setupCommand, operationInProgress: activeOperation });
  }

  function enqueue(operation, work) {
    if (pendingCount >= maxQueue) return Promise.reject(new CompilerError('The compiler operation queue is full. Try again after the current operation finishes.', 429));
    pendingCount++;
    const pending = queue.then(async () => {
      activeOperation = operation;
      try { return await work(); } finally { activeOperation = null; }
    }).finally(() => { pendingCount--; });
    queue = pending.catch(() => {});
    return pending;
  }

  async function discoveredProfiles() {
    const directory = path.join(root, 'devices');
    const profiles = new Map();
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return profiles;
    } catch { return profiles; }
    for (const target of new Set(Object.values(DEVICES).map(device => device.id))) {
      const profile = path.join(directory, target);
      try {
        const directoryInfo = await lstat(profile);
        const compilerFile = path.join(profile, 'compiler.json');
        const metadataInfo = await lstat(compilerFile);
        const binaryInfo = await lstat(path.join(profile, `${target}.bin`));
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !metadataInfo.isFile() ||
            metadataInfo.isSymbolicLink() || metadataInfo.size > 2 * 1024 * 1024 ||
            !binaryInfo.isFile() || binaryInfo.isSymbolicLink() || !binaryInfo.size || binaryInfo.size > 32 * 1024 * 1024) continue;
        const metadata = JSON.parse(await readFile(compilerFile, 'utf8'));
        if (metadata.deviceId === target) profiles.set(target, profile);
      } catch { /* Partial or invalid profiles are never passed to Garmin's compiler. */ }
    }
    return profiles;
  }

  async function syncProfiles() {
    try {
      const result = await profileImporter(data, devicesPath);
      profileWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
    } catch (error) {
      profileWarnings = [`Device profiles could not be imported: ${error.message} Existing profiles were retained.`];
    }
    lastProfileSync = now();
    installed = await discoveredProfiles();
  }

  async function updateReadiness() {
    let sdkVersion = null;
    try { sdkVersion = (await readFile(path.join(sdk, 'bin', 'version.txt'), 'utf8')).trim(); } catch {}
    const devices = Object.entries(DEVICES).filter(([, device]) => installed.has(device.id)).map(([id]) => id);
    let sdkManager;
    if (environment.container) {
      sdkManager = { supported: false, installed: false, runtimeReady: false, reason: 'Run SDK Manager on your desktop and mount its Devices and Fonts directories read-only into Docker.' };
    } else {
      try { sdkManager = await managerInspector({ dataDir: data }); }
      catch (error) { sdkManager = { supported: nativeManagerSupported, installed: false, runtimeReady: false, reason: `SDK Manager readiness could not be checked: ${error.message}` }; }
    }
    const sdkInstalled = await exists(jar);
    let desktopCapability = { supported: false, reason: environment.container ? 'SDK Manager runs on your desktop, outside Docker.' : 'One-click desktop setup supports Linux x86-64 Ubuntu and Linux Mint desktops.' };
    if (nativeManagerSupported) {
      try { desktopCapability = await desktopInspector(); }
      catch (error) { desktopCapability.reason = `Desktop setup could not be checked: ${error.message}`; }
    }
    snapshot = { sdkInstalled, sdkVersion, devices, sdkDevices: [...installed.keys()], keyReady: await exists(keyFile), sdkManager,
      desktopSetupSupported: desktopCapability.supported, desktopSetupReason: desktopCapability.reason,
      available: false, compilerReady: false, reason: 'Garmin SDK is not installed. Set up the compiler or configure GARMIN_SDK_PATH.' };
    if (!sdkInstalled) return;
    try {
      const runtime = await runBounded(javaPath, ['-version'], { timeout: 5000, logLimit: 2000 });
      if (runtime.code !== 0) { snapshot.reason = 'Java could not start. Install a headless Java 17 or 21 runtime.'; return; }
      const version = /(?:openjdk|java) version "(\d+)(?:\.(\d+))?/.exec(runtime.diagnostics);
      const major = version ? Number(version[1] === '1' ? version[2] : version[1]) : null;
      if (major && major < 11) { snapshot.reason = 'Garmin’s compiler requires Java 11 or newer. Install a headless Java 17 or 21 runtime.'; return; }
    } catch { snapshot.reason = 'Java is not available. Install a headless Java 17 or 21 runtime.'; return; }
    snapshot.available = true;
    snapshot.compilerReady = devices.length > 0;
    snapshot.reason = devices.length ? 'Compiler ready for the installed watch profiles.' : 'SDK ready. Sign in in Garmin SDK Manager and download your watch profile; it will be imported automatically.';
  }

  async function status() {
    // Status polling must never mutate files used by a running compiler or wait for a build/setup.
    if (pendingCount) return readinessSnapshot();
    if (now() - lastProfileSync >= 10000) {
      await enqueue('import profiles', async () => { await syncProfiles(); await updateReadiness(); });
    }
    return readinessSnapshot();
  }

  async function ensureKey() {
    await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(keyFile), 0o700);
    if (!await exists(keyFile)) {
      const { privateKey } = await keyPair('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } });
      try { await writeFile(keyFile, privateKey, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await chmod(keyFile, 0o600);
  }

  async function linkProfiles(profiles) {
    const connectIq = path.join(compilerHome, '.Garmin', 'ConnectIQ');
    await mkdir(path.join(connectIq, 'Devices'), { recursive: true });
    for (const [id, source] of profiles) {
      const destination = path.join(connectIq, 'Devices', id);
      await rm(destination, { recursive: true, force: true });
      await symlink(source, destination, 'dir');
    }
    const fonts = path.join(root, 'fonts');
    if (await exists(fonts)) {
      const destination = path.join(connectIq, 'Fonts');
      await rm(destination, { recursive: true, force: true });
      await symlink(fonts, destination, 'dir');
    }
  }

  async function compile(input) {
    let project;
    try { project = normalizeProject(input); }
    catch (error) { throw new CompilerError(error.message, 400); }
    await syncProfiles();
    await updateReadiness();
    const readiness = readinessSnapshot();
    if (!readiness.available) throw new CompilerError(readiness.reason, 503);
    const target = DEVICES[project.device].id;
    const profiles = installed;
    if (!profiles.has(target)) throw new CompilerError(`The ${DEVICES[project.device].name} SDK profile is missing. Download it in Garmin SDK Manager, then refresh profiles.`, 503);
    await ensureKey();
    await linkProfiles(profiles);
    const directory = path.join(data, 'builds');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const working = await mkdtemp(path.join(directory, 'face-'));
    try {
      for (const [relative, content] of Object.entries(generateGarminFiles(project))) {
        const filename = path.resolve(working, relative);
        if (!filename.startsWith(`${working}${path.sep}`)) throw new CompilerError('The generated project contains an invalid path.', 500);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, content);
      }
      const output = path.join(working, 'face.prg');
      const result = await runBounded(javaPath, [
        '-Xms64m', '-Xmx512m', '-Djava.awt.headless=true', '-Dfile.encoding=UTF-8',
        `-Duser.home=${compilerHome}`, '-classpath', jar, 'com.garmin.monkeybrains.Monkeybrains',
        '-f', path.join(working, 'monkey.jungle'), '-d', target,
        '-o', output, '-y', keyFile, '-r', '-w',
      ], { cwd: working, timeout });
      const diagnostics = result.diagnostics.replaceAll(working, '[generated project]').replaceAll(keyFile, '[private signing key]');
      if (result.code !== 0) throw new CompilerError('Garmin could not compile this face. Review the compiler diagnostics.', 422, diagnostics);
      if (!await exists(output)) throw new CompilerError('The Garmin compiler exited without creating a watch file.', 422, diagnostics);
      if ((await stat(output)).size > MAX_PRG) throw new CompilerError('The compiled watch file exceeds the 8 MiB download limit.', 422, diagnostics);
      const bytes = await readFile(output);
      if (!bytes.length) throw new CompilerError('The Garmin compiler created an empty watch file.', 422, diagnostics);
      const stem = project.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'instinctual-face';
      snapshot.keyReady = true;
      return { filename: `${stem}-${project.device}.prg`, bytes, device: project.device, sdkDevice: target, diagnostics };
    } finally { await rm(working, { recursive: true, force: true }); }
  }

  function desktopOperation(operation, work) {
    if (!nativeManagerSupported) return Promise.reject(new CompilerError('Desktop setup must run on a supported Linux desktop outside Docker.', 400));
    if (setupPromise) return setupOperation === operation ? setupPromise : Promise.reject(new CompilerError('Another SDK setup step is running. Wait for it to finish, then retry.', 409));
    setupProgress = 'Waiting for the current compiler operation…';
    setupError = null;
    const onProgress = message => { setupProgress = String(message).slice(0, 1000); };
    const pending = enqueue(operation, async () => {
      try {
        const capability = await desktopInspector();
        if (!capability.supported) throw new CompilerError(capability.reason, 400);
        await work(onProgress);
        await syncProfiles();
        await updateReadiness();
      } catch (error) {
        setupError = error.message;
        onProgress('Setup needs attention. You can retry after correcting the reported issue.');
        await updateReadiness();
        throw new CompilerError(setupError, error.status ?? 503, error.diagnostics ?? '');
      }
    });
    setupOperation = operation;
    setupPromise = pending.finally(() => { setupPromise = undefined; setupOperation = undefined; }).then(() => readinessSnapshot());
    return setupPromise;
  }

  return {
    status,
    build(input) {
      let snapshot;
      try { snapshot = structuredClone(input); } catch (error) { return Promise.reject(new CompilerError(`The watch-face design cannot be copied: ${error.message}`, 400)); }
      return enqueue('build', () => compile(snapshot));
    },
    refreshProfiles() {
      return enqueue('import profiles', async () => { await syncProfiles(); await updateReadiness(); return readinessSnapshot(); });
    },
    setupDesktop({ acceptedLicense = false } = {}) {
      if (acceptedLicense !== true) return Promise.reject(new CompilerError(`Accept Garmin’s SDK developer agreement before setup: ${LICENSE_URL}`, 400));
      return desktopOperation('desktop setup', onProgress => desktopInstaller({ dataDir: data, acceptedLicense: true, onProgress }));
    },
    openSdkManager() {
      return desktopOperation('open SDK Manager', onProgress => desktopManagerOpener({ dataDir: data, onProgress }));
    },
    setup({ acceptedLicense = false } = {}) {
      if (acceptedLicense !== true) return Promise.reject(new CompilerError(`Accept Garmin’s SDK developer agreement before downloading: ${LICENSE_URL}`, 400));
      if (setupPromise) return setupPromise;
      setupProgress = 'Waiting to set up the Garmin compiler…';
      setupError = null;
      const onProgress = message => { setupProgress = String(message).slice(0, 1000); };
      const pending = enqueue('setup', async () => {
        let sdkReady = false;
        try {
          if (environment.platform !== 'linux') throw new CompilerError('Automatic SDK setup currently supports Linux. Download Garmin SDK Manager for your operating system and configure GARMIN_SDK_PATH.', 400);
          await sdkInstaller({ dataDir: data, acceptedLicense: true, profilesPath: devicesPath, onProgress });
          sdkReady = true;
          await syncProfiles();
          await updateReadiness();
          if (nativeManagerSupported) {
            onProgress('Preparing Garmin SDK Manager for your one-time sign-in…');
            await managerPreparer({ dataDir: data, acceptedLicense: true, onProgress });
          }
          await updateReadiness();
          onProgress(environment.container ? 'Compiler setup complete. Download watch profiles on your desktop; this instance imports mounted profiles automatically.' :
            nativeManagerSupported ? 'Compiler setup complete. Choose Open SDK Manager, or Set up & open Garmin if desktop libraries are missing.' :
            'Compiler setup complete. Install Garmin SDK Manager on a supported desktop to download your watch profile.');
        } catch (error) {
          setupError = sdkReady ? `The compiler SDK is installed, but SDK Manager preparation failed: ${error.message} Retry SDK setup or use Set up & open Garmin on a supported local desktop.` : error.message;
          onProgress('Setup needs attention.');
          await updateReadiness();
          throw new CompilerError(setupError, error.status ?? 503, error.diagnostics ?? '');
        }
      });
      setupOperation = 'setup';
      setupPromise = pending.finally(() => { setupPromise = undefined; setupOperation = undefined; }).then(() => readinessSnapshot());
      return setupPromise;
    },
  };
}
