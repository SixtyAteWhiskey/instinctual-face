import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setupGarminSdk, LICENSE_URL } from './setup-garmin-sdk.mjs';
import {
  parseManagerArgs, parseOsRelease, runtimeInstallSupported, inspectSdkManager,
  prepareSdkManager, ensureBuildTools, installRuntime, launchManager,
} from './setup-sdk-manager.mjs';

/** Desktop capability is independent of whether a browser request is local. */
export function desktopSetupSupport({ platform, arch, container, display, release, hasPkexec }) {
  if (container) return { supported: false, reason: 'Docker runs the compiler on its server. Install and sign in to SDK Manager on your desktop, then connect its Devices and Fonts folders.' };
  if (platform !== 'linux' || arch !== 'x64') return { supported: false, reason: 'One-click desktop setup supports Linux x86-64. Use Garmin’s SDK Manager installer for Windows or macOS.' };
  if (!display) return { supported: false, reason: 'This server has no desktop display. SDK Manager must run on a desktop computer.' };
  if (!runtimeInstallSupported(release, platform, arch)) return { supported: false, reason: 'One-click desktop dependencies support Ubuntu 22.04/24.04 and corresponding Linux Mint releases. Install Garmin’s desktop tools with your operating system’s installer.' };
  if (!hasPkexec) return { supported: false, reason: 'Desktop administrator prompts are unavailable. Install the polkit desktop components using your operating system’s Software Manager.' };
  return { supported: true, reason: 'This desktop supports automatic setup. Approve any administrator prompts, then sign in in Garmin’s window and download your watch.' };
}

export async function inspectDesktopSetup() {
  let release = {}, hasPkexec = false;
  try { release = parseOsRelease(await readFile('/etc/os-release', 'utf8')); } catch {}
  try { await access('/usr/bin/pkexec', constants.X_OK); hasPkexec = true; } catch {}
  return desktopSetupSupport({ platform: process.platform, arch: process.arch,
    container: process.env.INSTINCTUAL_FACE_CONTAINER === '1',
    display: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY), release, hasPkexec });
}

const managerProgress = result => result?.alreadyOpen
  ? 'Garmin SDK Manager is already open. Switch to its desktop window, sign in if needed, and download your watch in Devices; this panel will detect it automatically.'
  : 'Garmin SDK Manager opened. Sign in and download your watch in Devices; this panel will detect it automatically.';

/** Fixed local actions. HTTP callers must pass the server's desktop-request gate. */
export async function setupDesktop({
  dataDir = process.env.DATA_DIR ?? 'data', acceptedLicense = false,
  installDependencies = true, launch = true, onProgress = () => {},
  inspector = inspectDesktopSetup, toolsInstaller = ensureBuildTools,
  managerPreparer = prepareSdkManager, runtimeInstaller = installRuntime,
  sdkInstaller = setupGarminSdk, managerLauncher = launchManager,
} = {}) {
  if (acceptedLicense !== true) throw new Error(`Read and accept Garmin’s developer agreement before setup: ${LICENSE_URL}`);
  const capability = await inspector();
  if (!capability.supported) throw new Error(capability.reason);
  if (installDependencies) await toolsInstaller({ dataDir, onProgress });
  let manager = await managerPreparer({ dataDir, acceptedLicense: true, onProgress });
  if (installDependencies) manager = await runtimeInstaller({ dataDir, onProgress });
  const sdk = await sdkInstaller({ dataDir, acceptedLicense: true, importProfiles: false, onProgress });
  let launched;
  if (launch) {
    onProgress('Opening Garmin SDK Manager for your sign-in…');
    launched = await managerLauncher(manager);
  }
  onProgress(launch ? managerProgress(launched) : 'Garmin tools are installed.');
  return { sdkPath: sdk.sdkPath, sdkManager: manager };
}

export async function openDesktopManager({ dataDir = process.env.DATA_DIR ?? 'data', inspector = inspectDesktopSetup, managerInspector = inspectSdkManager, managerLauncher = launchManager, onProgress = () => {} } = {}) {
  const capability = await inspector();
  if (!capability.supported) throw new Error(capability.reason);
  const manager = await managerInspector({ dataDir });
  if (!manager.runtimeReady) throw new Error('SDK Manager needs setup first. Choose Set up & open Garmin.');
  const launched = await managerLauncher(manager);
  onProgress(managerProgress(launched));
  return launched;
}

async function main() {
  const options = parseManagerArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Instinctual Face → Export face → SDK setup provides one-click setup on supported local Linux desktops.\n\nOptional terminal setup:\n  npm run setup:desktop -- --accept-license --install-dependencies --launch\n\nRead Garmin’s agreement before using --accept-license: ${LICENSE_URL}\n--install-dependencies permits desktop administrator prompts for missing prerequisites.\n--launch opens Garmin’s window for sign-in and watch selection.\n--data-dir DIRECTORY chooses the app’s private data directory.\n--check reports SDK Manager readiness without changing files.`);
    return;
  }
  if (options.check) {
    const manager = await inspectSdkManager({ dataDir: options.dataDir });
    console.log(JSON.stringify(manager, null, 2));
    if (!manager.runtimeReady) process.exitCode = 1;
    return;
  }
  await setupDesktop({ ...options, onProgress: console.log });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
