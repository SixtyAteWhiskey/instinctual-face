import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopSetupSupport, setupDesktop, openDesktopManager } from '../scripts/setup-desktop.mjs';

const supported = { platform: 'linux', arch: 'x64', container: false, display: true,
  release: { ID: 'linuxmint', UBUNTU_CODENAME: 'noble' }, hasPkexec: true };

test('one-click setup requires a supported native desktop and administrator prompt support', () => {
  assert.equal(desktopSetupSupport(supported).supported, true);
  for (const change of [{ container: true }, { display: false }, { platform: 'darwin' }, { arch: 'arm64' }, { release: { ID: 'debian' } }, { hasPkexec: false }]) {
    const status = desktopSetupSupport({ ...supported, ...change });
    assert.equal(status.supported, false);
    assert.ok(status.reason.length > 20);
  }
});

test('desktop setup checks prerequisites, installs fixed Garmin tools, then opens sign-in without handling credentials', async () => {
  const steps = [], progress = [];
  const manager = { installed: true, runtimeReady: false };
  const ready = { ...manager, runtimeReady: true };
  const common = { dataDir: '/tmp/a private directory', onProgress: message => progress.push(message) };
  const result = await setupDesktop({ ...common, acceptedLicense: true,
    inspector: async () => { steps.push('capability'); return { supported: true }; },
    toolsInstaller: async options => { assert.deepEqual(options, common); steps.push('prerequisites'); },
    managerPreparer: async options => { assert.deepEqual(options, { ...common, acceptedLicense: true }); steps.push('download manager'); return manager; },
    runtimeInstaller: async options => { assert.deepEqual(options, common); steps.push('desktop libraries'); return ready; },
    sdkInstaller: async options => { assert.deepEqual(options, { ...common, acceptedLicense: true, importProfiles: false }); steps.push('download SDK'); return { sdkPath: '/tmp/sdk' }; },
    managerLauncher: async status => { assert.equal(status, ready); steps.push('open manager'); },
  });
  assert.deepEqual(steps, ['capability', 'prerequisites', 'download manager', 'desktop libraries', 'download SDK', 'open manager']);
  assert.deepEqual(result, { sdkPath: '/tmp/sdk', sdkManager: ready });
  assert.match(progress.at(-1), /opened.*Sign in.*automatically/);
});

test('desktop setup rejects missing license or unsupported hosts before any installation or GUI operation', async () => {
  const fail = async () => { throw new Error('An unauthorized operation was reached.'); };
  const dependencies = { toolsInstaller: fail, managerPreparer: fail, runtimeInstaller: fail, sdkInstaller: fail, managerLauncher: fail };
  for (const acceptedLicense of [false, undefined, 1, 'true']) await assert.rejects(setupDesktop({ ...dependencies, acceptedLicense, inspector: fail }), /Read and accept/);
  await assert.rejects(setupDesktop({ ...dependencies, acceptedLicense: true, inspector: async () => ({ supported: false, reason: 'No desktop is available.' }) }), /No desktop/);
});

test('opening an installed manager needs no download, package installation or repeated license acceptance', async () => {
  const ready = { runtimeReady: true }, steps = [];
  await openDesktopManager({ dataDir: '/tmp/installed',
    inspector: async () => ({ supported: true }),
    managerInspector: async options => { assert.deepEqual(options, { dataDir: '/tmp/installed' }); steps.push('inspect'); return ready; },
    managerLauncher: async manager => { assert.equal(manager, ready); steps.push('open'); },
    onProgress: message => assert.match(message, /opened/),
  });
  assert.deepEqual(steps, ['inspect', 'open']);
  await assert.rejects(openDesktopManager({ inspector: async () => ({ supported: true }), managerInspector: async () => ({ runtimeReady: false }), managerLauncher: async () => assert.fail('Must not launch an incomplete installation.') }), /Set up & open Garmin/);
});

test('desktop setup and open actions honestly report that Manager is already open', async () => {
  const progress = [], ready = { runtimeReady: true };
  const common = { inspector: async () => ({ supported: true }), onProgress: message => progress.push(message),
    managerLauncher: async () => ({ alreadyOpen: true }) };
  await setupDesktop({ ...common, acceptedLicense: true,
    toolsInstaller: async () => {}, managerPreparer: async () => ready,
    runtimeInstaller: async () => ready, sdkInstaller: async () => ({ sdkPath: '/tmp/sdk' }),
  });
  assert.match(progress.at(-1), /already open.*Switch to its desktop window/);
  const result = await openDesktopManager({ ...common, managerInspector: async () => ready });
  assert.deepEqual(result, { alreadyOpen: true });
  assert.match(progress.at(-1), /already open.*Switch to its desktop window/);
  assert.doesNotMatch(progress.at(-1), /Manager opened\./);
});
