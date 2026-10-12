# Build a watch file

Instinctual Face can compile and sign a device-specific `.prg` on its own server once Garmin's SDK, Java, and your selected watch's SDK profile are installed. A source ZIP remains available for manual builds and simulator testing.

## One-time setup

Setup automates downloading Garmin's SDK, preparing its runtime, importing profiles, creating the private signing key, and compiling the watch file. Garmin account sign-in and the first watch-profile selection happen in Garmin's own SDK Manager. There is no Garmin password field in Instinctual Face.

### One-click Linux desktop setup

On an **x64 Ubuntu 22.04/24.04 desktop**, or a corresponding **Linux Mint** release, open the locally running application at `http://localhost:3000` or `http://127.0.0.1:3000`. Choose **Export face → SDK setup**. Read the linked Garmin agreement, select its initially unchecked acceptance box, then click **Set up & open Garmin**. No terminal commands are needed for SDK setup.

The button checks for Java 11 or newer (Java 17 is recommended) and Python 3, downloads the SDK and SDK Manager from Garmin's official HTTPS download locations, prepares missing desktop libraries, and opens SDK Manager. Necessary package installation asks for administrator authorization through the desktop's own prompt; enter your password there. Compatibility packages are verified against signed Ubuntu APT metadata, and WebKit's normal sandbox remains enabled. Cancelling an administrator prompt leaves existing tools intact and displays an error that can be retried.

1. Sign in inside SDK Manager and accept any agreement Garmin presents.
2. Under **Devices**, download your watch. For Instinct 3 Solar 45 mm and 50 mm, Garmin's shared compiler product ID is **`instinct3solar45mm`**. AMOLED sizes have separate profiles.
3. Return to Instinctual Face. The setup panel checks automatically for your downloaded profile and enables **Build & download watch file**. The application also imports profiles before each build.

Once Manager is installed and its libraries are ready, **Open SDK Manager** reopens Garmin's window without another download or agreement checkbox. **SDK setup** remains accessible after the compiler is ready. If the exact installed Manager is already running under your user account, the panel tells you to switch to its existing desktop window; it does not attempt another instance.

SDK files live privately in `data/garmin/sdk`, and Manager files in `data/garmin/sdk-manager`, or under `DATA_DIR` when configured. Existing installations are reused. Garmin's materials are downloaded for the user's installation rather than bundled with the application image. Instinctual Face does not read, collect, or copy Manager credentials or session files.

Desktop actions are restricted on the server: their dedicated JSON endpoints require a loopback socket, a literal local Host at the server's bound port, and the exact matching browser Origin. Forwarded/proxy headers, cross-origin requests, remote connections, and DNS rebinding Hosts are rejected before any package installation or GUI launch. The app also prevents cross-site framing. Ordinary SDK downloads remain available on server/container installations and never request privileges or launch windows.

Garmin's [documented Manager setup](https://developer.garmin.com/connect-iq/connect-iq-basics/getting-started/) includes an account login. The public SDK archive contains the compiler, but does not contain current watch profiles; the unauthenticated profile catalogue returns HTTP 401.

### Docker, headless servers, and other operating systems

A browser cannot launch a desktop application on another computer, and the Docker image has no desktop login window. These installations show an accurate boundary in **SDK setup**: the browser can download the compiler on the server, while SDK Manager runs on the user's desktop. Connect its public **Devices** and **Fonts** folders using the read-only mounts described below. Native one-click setup requires the application server to inherit the local desktop display and run outside Docker.

On **macOS** and **Windows**, install [Garmin's official SDK Manager](https://developer.garmin.com/connect-iq/sdk/), sign in, and download both the SDK and your watch profile. Official downloads are available for [macOS](https://developer.garmin.com/downloads/connect-iq/sdk-manager/connectiq-sdk-manager.dmg) and [Windows](https://developer.garmin.com/downloads/connect-iq/sdk-manager/connectiq-sdk-manager-windows.zip). Set `GARMIN_SDK_PATH` to the existing SDK root when starting the server. Java and Python must be installed separately. The Linux desktop bootstrap does not support these operating systems or Linux ARM.

SDK Manager normally stores device folders at:

- Linux: `$HOME/.Garmin/ConnectIQ/Devices`
- macOS: `$HOME/Library/Application Support/Garmin/ConnectIQ/Devices`
- Windows: `%APPDATA%\Garmin\ConnectIQ\Devices`

For a custom Manager location, set the server's `GARMIN_PROFILE_SOURCE` to the directory containing watch profile folders. An explicit one-time local import is also available:

```sh
npm run setup:sdk -- --profiles-only
```

To import an existing directory explicitly, run the trusted local command:

```sh
npm run setup:sdk -- --profiles-only --profiles "/path/to/Garmin/ConnectIQ/Devices"
```

Imports copy supported watch-profile folders and device fonts only. They validate profile metadata and enforce limits on file count and total size, rejecting symbolic links and unsafe paths. SDK Manager login/session files are excluded.

### This Linux Mint desktop

The official SDK Manager requires WebKit GTK 4.0, while Mint 22.3 / Ubuntu 24.04 ships WebKit 4.1. The desktop bootstrap detects this mismatch and obtains the required compatibility libraries from signed Ubuntu APT metadata, with administrator installation authorized in the desktop prompt. It records verified package hashes privately in `data/garmin/sdk-manager/runtime/verified-packages.json`; package versions follow the authenticated repository metadata instead of a hardcoded version list.

After setup, use **Export face → SDK setup → Open SDK Manager** to reopen Garmin's window. Sign in and accept Garmin agreements directly there.

For operators who prefer a terminal, the same setup remains available from the project directory:

```sh
npm run setup:desktop -- --accept-license --install-dependencies --launch
```

The optional `--check` flag reports Manager runtime readiness without changing files or opening a window. A launcher is also available at `scripts/launch-sdk-manager.sh`. These are alternatives to the local web button, rather than required setup steps.

## Docker profile import

Docker includes Java and Python. Use **Export face → SDK setup** to download the SDK into its persistent data volume after agreement acceptance. SDK Manager runs on the desktop rather than inside the container.

The Docker image and Compose stack were built and checked on October 12, 2026, using Node.js 24 and Java 17. Health, nonroot execution, the isolated all-profile runtime check, and saved-face/template persistence across container recreation passed. The exact profile-mount workflow below also passed a signed Solar 3 build through `/api/build`, using read-only public profile/font imports, a writable SDK data volume, and a fresh private key.

For automatic imports, download your watch in desktop SDK Manager and expose only its **Devices** and **Fonts** directories through the read-only mounts in `compose.profiles.yaml`. On Linux, start with:

```sh
export GARMIN_DEVICES_DIR="$HOME/.Garmin/ConnectIQ/Devices"
export GARMIN_FONTS_DIR="$HOME/.Garmin/ConnectIQ/Fonts"
docker compose -f compose.yaml -f compose.profiles.yaml up -d --build
```

The override sets `GARMIN_PROFILE_SOURCE=/garmin-import/Devices` inside the container. The application imports profiles during compiler status checks and builds; later profile downloads and updates are picked up without another manual copy. Only the two read-only data directories are mounted, rather than Manager's account/session directory. Create/download the folders in SDK Manager before starting this override.

For macOS, change the exports to:

```sh
export GARMIN_DEVICES_DIR="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices"
export GARMIN_FONTS_DIR="$HOME/Library/Application Support/Garmin/ConnectIQ/Fonts"
```

For Windows PowerShell, use:

```powershell
$env:GARMIN_DEVICES_DIR = Join-Path $env:APPDATA 'Garmin\ConnectIQ\Devices'
$env:GARMIN_FONTS_DIR = Join-Path $env:APPDATA 'Garmin\ConnectIQ\Fonts'
docker compose -f compose.yaml -f compose.profiles.yaml up -d --build
```

If you prefer a one-time copy into the persistent volume, these commands remain available:

```sh
docker compose cp "$HOME/.Garmin/ConnectIQ/Devices" instinctual-face:/app/data/garmin/devices
```

Copy the downloaded fonts too:

```sh
docker compose cp "$HOME/.Garmin/ConnectIQ/Fonts" instinctual-face:/app/data/garmin/fonts
```

Refresh compiler status in the editor after a manual copy. This method needs another copy when profiles change.

For an existing SDK installation, server operators can set `GARMIN_SDK_PATH` to its root and `GARMIN_DEVICES_PATH` to the directory containing device profile folders. These are server configuration settings; the build API accepts design JSON, never file paths or source code.

The SDK directory must be writable by the application user: Garmin's compiler updates `bin/default.jungle` and SDK cache files. A read-only SDK bind mount will fail compilation. Use the normal web setup, which downloads into the writable data volume, or copy an existing SDK into a writable volume. The **Devices** and **Fonts** import mounts remain read-only; the application validates and copies those public assets into its private cache before building.

## Download and install

1. Select the exact watch model in the editor.
2. Open Export and build the watch file. The build button becomes available when the matching profile and compiler are ready.
3. Download the generated `.prg`.
4. Connect the watch to your computer with USB and open its storage. Copy the `.prg` into `GARMIN/APPS`.
5. Safely disconnect the watch and choose the new face from its watch-face settings.

Garmin documents PRG sideloading in its [first app guide](https://developer.garmin.com/connect-iq/connect-iq-basics/your-first-app/). USB storage access varies by device and desktop operating system. Instinctual Face creates the file; your browser does not directly install it over Bluetooth or publish it to the Connect IQ store.

Verify your layout in Garmin's simulator and on the watch, particularly text clipping, fonts, subscreen placement, and AMOLED low-power behavior. See [device support and export details](GARMIN.md).

### Instinct 3 Solar on Linux Mint

1. On the watch, hold **MENU** (middle-left button), then choose **System → USB Mode → MTP**. Garmin documents this in the [Instinct 3 Solar system settings](https://www8.garmin.com/manuals/webhelp/GUID-2C274FD2-F0C3-445C-B0AC-700FECCE12E9/EN-US/GUID-1500E73F-F386-49AF-A542-25D4B1655A08.html).
2. Connect a data-capable USB cable. Open Mint's Files application and select the Garmin watch in the sidebar. Open its internal storage, then **GARMIN → APPS**.
3. Copy the device-specific `.prg` downloaded from Instinctual Face into that folder. Let the transfer finish, eject/disconnect, and unplug the watch.
4. From the watch face, hold **UP/MENU → Watch Face**, use **UP/DOWN** to choose the added face, then press **GPS → Apply**. See [Garmin's watch-face selection instructions](https://www8.garmin.com/manuals/webhelp/GUID-2C274FD2-F0C3-445C-B0AC-700FECCE12E9/EN-US/GUID-7CD73B1B-5800-45EF-86C1-B619FFE40AC5.html).

Both Solar case sizes compile with the SDK product ID `instinct3solar45mm`. Select your own case size in the studio; a successful build must explicitly target this product profile. Generic validation binaries are not suitable for installation.

## Signing key and build limits

The first successful build preparation automatically generates an RSA 4096-bit PKCS8 DER developer key at `data/private/developer_key.der`. The private directory is restricted to its owner and the key uses mode `0600`. The key persists across builds and is excluded from source ZIPs and HTTP downloads. Back up this key privately with the data volume if you want to preserve your signing identity. Garmin requires the same key to update a published application; see [Garmin's key instructions](https://developer.garmin.com/connect-iq/connect-iq-basics/getting-started/).

Builds run one at a time with a bounded queue, a 90-second process limit, and bounded diagnostics. Each build generates source from a validated design, invokes Java with argument arrays, returns its compiled file, and removes temporary source/build files. Compiler errors appear as diagnostics rather than a misleading successful download.

## Current validation

The public SDK installer was tested end to end with Garmin's official Connect IQ 9.2.0 Linux archive and Java 21. The actual Garmin compiler successfully compiled representative generated sources in its generic mode: Instinct 2 Minimal, Instinct 3 Solar Summit, and Instinct 3 AMOLED 50 mm Trail. Each produced a nonempty binary; validation reports and generic artifacts are in the ignored `data/garmin/validation` directory. These generic files validate source compilation and are not device-specific installation files.

The desktop SDK Manager runtime has been installed and launched. After the user's Garmin sign-in and device download, the application's actual device-specific build succeeded for `instinct3solar45mm` (Instinct 3 Solar 45/50 mm), producing a signed `.prg` with SDK 9.2.0. A simulator font probe then identified caption clipping and calibrated the exact subscreen; the corrected seven-element face compiled to 9,628 bytes. The browser downloaded it successfully, and the user confirmed its corrected simulator appearance. The build copy and metadata are kept privately in `data/first-solar-face`; the original editor projects remain available.

The connected watch was verified as **Instinct 3 - 50mm, Solar**, firmware **15.19**. The corrected file `summit-solar-first-face-instinct3solar50mm.prg` was copied to **Internal Storage/Garmin/Apps** over MTP, read back, and its SHA-256 matched the local build. Storage was safely unmounted. The user then applied the face and confirmed that it looks right on the watch. `data/first-solar-face/transfer.json` records the transfer and confirmation.

The final release check on October 12, 2026, rebuilt the saved **Alignment & spacing demo** through `/api/build` for `instinct3solar50mm`, targeting Garmin's shared `instinct3solar45mm` SDK profile. The signed download is 17,356 bytes, with SHA-256 `389e55a9f6c4f887827e6c82eb7be4b378828e3871556bd81eef2e4ca8c3bd0a`, and ran in a fresh Solar simulator without runtime errors. The current exporter, all 96 catalog elements using imperial preferences, and the instrumented probe compiled with zero warnings or errors. Thirty-six native checks passed for unit conversions, height formatting, bitmap/caption fitting, and measured main-display fonts/fallbacks. Instrumented memory was 34,920 of 61,256 bytes. Evidence is kept privately in ignored `data/garmin/validation/final-release`; this newer demo was not installed on the physical watch.

A separate nonroot Docker build using Java 17 and SDK 9.2.0 successfully imported Solar 3 public assets through `compose.profiles.yaml` and returned a signed 15,676-byte Summit Solar 50 mm `.prg` from `/api/build`. An in-container compiler check also reported `BUILD SUCCESSFUL` with zero warnings or errors. The SDK was copied into disposable writable storage, while imported Devices/Fonts stayed read-only. A fresh signing key used mode `0600`; no existing key or saved faces were mounted. Private evidence is in ignored `data/garmin/validation/final-release/docker-compilation.json`, and the disposable stack was removed afterward.

All 241 automated tests and JavaScript syntax checks pass. Tests validate build orchestration, queueing, key handling, timeout/log limits, error cleanup, and safe ZIP extraction. `npm run verify:runtime` checks temporary-server persistence, all 11 supported design profiles, exports, and unsafe-request rejection without an SDK. `npm run verify:docker` builds and verifies the actual image and disposable Compose stack, including volume persistence. GitHub Actions includes both checks. Only the Solar 3 authenticated profile is installed on this development machine; other targets and AMOLED always-on behavior require separate device-specific checks.

The automated desktop command was exercised on this Mint installation and reused the existing tools without another download or administrator prompt. An isolated browser fixture verified that an unchecked agreement prevents a setup request and that a newly available profile enables building without a manual refresh. An earlier app update rebuilt the first Solar face to the same 9,628-byte file and SHA-256 as the installed version. The optional Docker mount configuration parsed successfully; the final base-container startup and runtime checks passed as described above.

The one-click desktop flow has automated tests for its fixed installation order, license gate, administrator cancellation and retry, compiler queue, readiness polling, and opening an existing Manager without downloading it again. Endpoint tests reject forged Host/Origin headers, forwarding, cross-site requests, and remote sockets before desktop actions. Package installation and GUI actions are mocked in these tests.
