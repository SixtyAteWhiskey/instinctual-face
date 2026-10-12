# Instinctual Face

A self-hosted, drag-and-drop studio for Garmin Instinct Connect IQ watch faces. Design faces, share them as portable templates, and build signed watch files, with guided SDK setup and a one-time Garmin sign-in.

![Instinctual Face designer with alignment and even-spacing controls](docs/alignment-spacing.png)

- **Supported watches:** Instinct 2 / 2S / 2X, Instinct 3 Solar and AMOLED (45 / 50 mm), Instinct E (40 / 45 mm), and Crossover / Crossover AMOLED. The original Instinct and Instinct Solar don't support Connect IQ watch faces.
- **No dependencies:** Plain browser JavaScript and a Node.js server, with no npm packages and no database.
- **Optional compilation:** Uses Garmin's official Connect IQ SDK. The server creates its own signing key, and never sees your Garmin credentials.

## Quick start

**Docker (recommended):**

```sh
git clone https://github.com/SixtyAteWhiskey/instinctual-face.git
cd instinctual-face
docker compose up --build -d
```

Open <http://localhost:8080>. Designs are kept in the `instinctual-face-data` volume. The image includes Node.js 24, Java 17, and Python 3. Garmin's SDK, device profiles, and signing keys are not bundled.

**Node.js 22+ (no install step):**

```sh
npm start                              # http://localhost:3000
PORT=3001 DATA_DIR=./my-faces npm start
npm run dev                            # restart on file changes
```

> [!WARNING]
> There is no login. Anyone who can reach the server, including other devices on your LAN, can view, edit, and delete designs. To expose it to the internet, put it behind a reverse proxy with authentication and HTTPS.

## Build a watch file

On x64 Ubuntu 22.04/24.04 or Linux Mint, open the app at **localhost** and choose **Export face → SDK setup → Set up & open Garmin**. Accept Garmin's developer agreement. Setup then installs the SDK and opens Garmin's SDK Manager. In Garmin's SDK Manager, sign in and download your watch under **Devices**. Both Instinct 3 Solar sizes use the `instinct3solar45mm` profile.

Then choose **Export face → Build & download watch file** and copy the `.prg` to `GARMIN/APPS` on the watch over USB.

Docker, headless servers, macOS, and Windows use a guided manual setup. See the [compilation guide](docs/COMPILATION.md).

## Design a face

1. Choose your watch. Switching models rescales the layout and converts colors for monochrome screens.
2. Start from a template (**Summit**, **Minimal**, **Trail**) or **My faces → New face**.
3. Drag elements from the library onto the watch, then fine-tune them in **Properties** and **Layers**.
4. Set **Units** and try different **Sample data**, then switch to **Preview**.

The library has 96 elements: time, activity, health, weather, device status, training, shapes, icons, and progress bars and rings. The **safety margin** (on by default) keeps layers inside the visible display and away from the bezel.

See the [editing guide](docs/EDITING.md) for selection, alignment, spacing, and keyboard shortcuts. The [element guide](docs/ELEMENTS.md) covers the full catalog, captions, units, and data availability.

## Export and share

**Export face** provides:

| Option | What you get |
| --- | --- |
| Build & download watch file | A signed `.prg` for your device (requires SDK setup) |
| Connect IQ project ZIP | Monkey C source, manifest, and resources for manual builds |
| Editable design JSON | Import it from **My faces → Import JSON** |
| Preview SVG | A vector image of the current preview |

**Share** creates an `IF1` code that works on any Instinctual Face instance. Recipients can inspect the code and adapt it to their watch before adding it. Codes contain only validated layout data, not scripts or URLs. See [sharing details](docs/SHARING.md).

Preview fonts are approximate, and Instinct E window geometry is conservative, so check designs in Garmin's simulator or on the watch. See [Garmin export and device support](docs/GARMIN.md).

## Data and backups

Designs save automatically to the server, with a browser backup if the server goes offline. Data lives in `DATA_DIR` (default `./data`; `/app/data` in Docker):

- `projects.json`: all designs
- `templates.json`: shared templates
- The compiler's signing key

Back up and restore designs in Docker:

```sh
docker compose cp instinctual-face:/app/data/projects.json ./projects-backup.json

docker compose stop instinctual-face
docker compose cp ./projects-backup.json instinctual-face:/app/data/projects.json
docker compose start instinctual-face
```

Back up the whole volume to keep templates and the signing key as well. `docker compose down` keeps the volume, but `down -v` deletes it.

## Development

```sh
npm run check            # syntax checks
npm test                 # unit tests
npm run verify:runtime   # end-to-end checks against a temporary server
npm run verify:docker    # builds and tests the Docker image (requires Docker)
```

CI runs these on Node.js 22 and 24. See the [validation record](docs/VALIDATION.md) for test coverage and on-device results, and the [roadmap](docs/ROADMAP.md) for planned work.

| Path | Purpose |
| --- | --- |
| `server.mjs` | HTTP server and API |
| `compiler.mjs` | SDK setup and trusted builds |
| `templates.mjs` | Shared template storage |
| `web/app.js`, `web/workflows.js` | Editor UI, sharing, and installation flows |
| `web/model.js`, `web/elements.js`, `web/devices.js` | Layout validation, element catalog, and device profiles |
| `web/garmin-export.js` | Monkey C source generation |

---

Instinctual Face is an independent project and is not affiliated with Garmin.
