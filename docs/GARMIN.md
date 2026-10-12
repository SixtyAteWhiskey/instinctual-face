# Garmin export and device support

Instinctual Face exports a complete Connect IQ source project as a ZIP. It contains Monkey C source, a manifest, a Jungle build file, resource strings, an SVG launcher icon, build instructions, and the original editable design. Device compilation needs Garmin's SDK, an installed device profile, and a developer signing key; downloading source alone does not produce an installable watch app.

| Editor device | SDK product ID | Connect IQ canvas | Display |
| --- | --- | --- | --- |
| Instinct 2 / Solar / Dual Power / dēzl | `instinct2` | 176 × 176 | Semi-octagon, monochrome MIP |
| Instinct 2S / Solar / Dual Power | `instinct2s` | 163 × 156 | Semi-octagon, monochrome MIP |
| Instinct 2X Solar | `instinct2x` | 176 × 176 | Semi-octagon, monochrome MIP |
| Instinct 3 Solar 45 mm | `instinct3solar45mm` | 176 × 176 | Semi-octagon, monochrome MIP |
| Instinct 3 Solar 50 mm | `instinct3solar45mm` | 176 × 176 | Semi-octagon, monochrome MIP |
| Instinct 3 AMOLED 45 mm | `instinct3amoled45mm` | 390 × 390 | Round, AMOLED color |
| Instinct 3 AMOLED 50 mm | `instinct3amoled50mm` | 416 × 416 | Round, AMOLED color |
| Instinct Crossover / Solar | `instinctcrossover` | 176 × 176 | Semi-octagon, monochrome MIP |
| Instinct Crossover AMOLED | `instinctcrossoveramoled` | 390 × 390 | Round, AMOLED color |
| Instinct E 40 mm | `instincte40mm` | 166 × 166 | Semi-octagon, monochrome MIP |
| Instinct E 45 mm | `instincte45mm` | 176 × 176 | Semi-octagon, monochrome MIP |

This covers every Instinct family profile in Garmin's [compatible device list](https://developer.garmin.com/connect-iq/compatible-devices/), checked October 11, 2026. The IDs, shapes, dimensions, icon sizes, and available fonts were also checked in the official SDK 9.2.0 device reference. Garmin uses one [Instinct 3 Solar SDK profile](https://developer.garmin.com/connect-iq/device-reference/instinct3solar45mm/) for both Solar case sizes; the editor offers separate choices while exporting that shared ID. The Instinct 2S SDK canvas differs from its marketed 156 × 156 panel resolution.

Solar, Tactical, Surf, Camo, Dual Power, and dēzl editions use their corresponding generation, display technology, and case-size profile where applicable. Garmin's [Connect IQ product catalog](https://www.garmin.com/en-US/c/connect-iq-compatible-devices/) includes the tactical Instinct 3 and both Crossover display technologies. The [Instinct 3 AMOLED manual](https://www8.garmin.com/manuals/webhelp/GUID-2DA54DF8-8084-40ED-954F-EDA09C13B47F/EN-US/Instinct_3_AMOLED_OM_EN-US.pdf) covers Tactical models and Connect IQ watch faces. AMOLED is the OLED display technology offered by these Instinct models.

The original **Instinct** and first-generation **Instinct Solar**, including their edition variants, cannot install Connect IQ watch faces. They appear as unavailable choices in the editor and imports/exports reject them. They are absent from Garmin's compatible-device list; Garmin's [compatibility guidance](https://support.garmin.com/en-IE/?faq=jNPCPTtSF9249pBoAtfdo7) directs users to the product specifications and manual. Upgrading this application cannot add Connect IQ support to that hardware.

The shared registry lives in `web/devices.js`. AMOLED designs accept safe `#RRGGBB` colors, rendered as Garmin RGB integers; the hardware uses a 65,536-color display, so physical colors may be quantized. Monochrome designs use `#111111` and `#eeeeee`, exported as true black and white. Switching a color design to monochrome converts each color using weighted RGB brightness. Coordinates, dimensions, and font sizes scale to the selected profile. New AMOLED templates use separate placements to keep their rectangles inside the round display.

## Compile, preview, and install

1. Follow Garmin's [getting started guide](https://developer.garmin.com/connect-iq/connect-iq-basics/getting-started/) to install SDK Manager and the official Monkey C extension for Visual Studio Code. Install the target device profile in SDK Manager.
2. Download the source ZIP, extract it, and open its folder in VS Code.
3. Use **Monkey C: Generate a Developer Key**, or configure an existing key. Garmin requires an RSA 4096-bit private key for signing. Preserve the key when updating a published app.
4. Open a `.mc` file and use **Run Without Debugging**, selecting the target device, to preview the face in Garmin's simulator.
5. Use **Monkey C: Build for Device**. Copy the resulting `.prg` to the connected watch's `GARMIN/APPS` folder, disconnect, and select the face. See Garmin's [first app and sideload guide](https://developer.garmin.com/connect-iq/connect-iq-basics/your-first-app/).

The generated ZIP also includes an SDK command line example. Store distribution requires a separate [Garmin submission](https://developer.garmin.com/connect-iq/submit-an-app/).

## What runs on the watch

The generated `WatchUi.WatchFace` redraws the display in `onUpdate()`. Garmin controls its lifecycle; ordinary low-power updates occur once per minute. It uses no timers or animation. See [View lifecycle](https://developer.garmin.com/connect-iq/api-docs/Toybox/WatchUi/View.html) and [watch-face app behavior](https://developer.garmin.com/connect-iq/articles/connect-iq-basics/App_Types.html).

- Time comes from `System.getClockTime()`. Date uses local `Gregorian.info(Time.now(), Time.FORMAT_SHORT)`, displayed with English month and day names. See [System](https://developer.garmin.com/connect-iq/api-docs/Toybox/System.html) and [Gregorian](https://developer.garmin.com/connect-iq/api-docs/Toybox/Time/Gregorian.html).
- Battery comes from `System.getSystemStats().battery`; see [Stats](https://developer.garmin.com/connect-iq/api-docs/Toybox/System/Stats.html).
- Steps, calories, floors, and distance use daily `ActivityMonitor` totals. Distance converts Garmin centimeters to canonical kilometers, then to the selected kilometers or miles. Unsupported or missing values display `--`; see [ActivityMonitor.Info](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityMonitor/Info.html).
- Heart rate shows the newest recorded history sample, with invalid samples checked. It does not enable continuous sensor acquisition; see [ActivityMonitor.getHeartRateHistory](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityMonitor.html#getHeartRateHistory-instance_function).

The expanded library reads recorded sensor history, cached weather, user profile fields, device status, and supported native complications. Generated readers guard optional APIs and null values; missing readings show `--`. Permissions are selected from the visible elements rather than assigned by imported templates. See [the element guide](ELEMENTS.md) for source links, model and firmware requirements, the catalog, and fields Garmin does not expose to watch faces.

Captions have independent text, size, gap, alignment, and color. Hidden layers are omitted. Locked layers, grid, snapping, and zoom affect editing and are preserved in the design JSON.

## Preview fidelity

Safety margin defaults to enabled and is shared by the designer and exported source. The browser mask combines the main display and secondary circle, subtracting the opaque circular bezel. A scaled three-pixel inset constrains every corner of each layer; it can be disabled for free placement. Physical main-display outlines are conservative approximations, and Instinct E secondary-window geometry is approximate until its SDK profile is measured. Existing design coordinates remain editable; effective preview and export copies are fitted identically. **Fit face** or enabling the margin commits those safe positions.

Resizing a layer’s Width/Height or its corner handle scales its requested primary font size, while independent caption style overrides are preserved. The value and caption font-size fields remain individually adjustable. Safety-enabled circle text uses an original 5 × 7 pixel font with independently fitted horizontal and vertical scales; the SVG preview and watch draw exactly the same cells. Long readings such as `100,000` condense horizontally to stay readable. Editable captions use an original 3 × 5 pixel alphabet including digits and punctuation. The shared caption budget uses its fitted glyph height, chosen gap, and bottom padding; the default remains nine pixels, scaled by an integer factor on higher-resolution devices. Main-display export measures each live value and chooses the closest built-in font that fits both dimensions, falling back to compact pixel text when none fits. Excessively long pixel strings use ellipsis, unsupported compact glyphs become `?`, and boxes below a readable pixel minimum draw no partial text. No cache accumulates live readings. Main browser fonts remain approximate. See Garmin’s [font constants](https://developer.garmin.com/connect-iq/api-docs/Toybox/Graphics.html) and [drawing and clipping API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Graphics/Dc.html).


Actual Solar 3 simulator measurements confirmed a 23-pixel smallest font, rather than the older bundled reference's 21-pixel value. New Solar starter elements reserve at least 24 pixels for unlabeled text and 32 pixels for labeled metrics. Explicit geometry in existing designs is retained; safety-enabled preview and export fit copies to visible geometry. The first Solar build copy was corrected using these measured dimensions.

On models with a physical subscreen, it is part of the drawable screen. Garmin exposes its runtime bounding box via [WatchUi.getSubscreen()](https://developer.garmin.com/connect-iq/api-docs/Toybox/WatchUi.html#getSubscreen-instance_function), available since API 3.2.7; its supported devices include Instinct 2, 2S, 2X, 3 Solar, and E. The registry records the older models' official subscreen data-field rectangles: 2/2X `(113, 1, 62, 62)` and 2S `(109, 0, 54, 54)`. The authenticated Solar 3 profile and simulator confirmed `(113, 0, 62, 62)`; both Solar case choices now use that exact guide. Instinct E uses conservative family proportions and is marked approximate in the designer. Crossover has physical analog hands and no circular subscreen; verify that hands do not obscure important text. AMOLED models have round displays. The export clears and redraws the full display each update. Confirm all placements in the simulator and on hardware.

The launcher icon is a simple black-and-white SVG sized to the official target reference: 26–62 pixels depending on the model. Garmin's [resource compiler](https://developer.garmin.com/connect-iq/articles/core-topics/Resources.html) supports SVG and converts it to a device bitmap.

Outline circles use `Dc.drawEllipse(x, y, a, b)`, where Garmin defines `x` and `y` as the center and `a` and `b` as axis radii. The exporter converts the editor's top-left position and dimensions to this representation.

## AMOLED always-on behavior

AMOLED watch faces use `onEnterSleep()` and `onExitSleep()` to switch between the active design and a separate dim time-only display. In sleep, the export clears to pure black and draws gray time inside a clipped rectangle occupying less than 7% of the circular display, below Garmin's documented 10% pixel limit. The time alternates between disjoint upper and lower rows each minute and shifts horizontally by up to four pixels. Custom colors, backgrounds, labels, and activity metrics are omitted from this mode. The first visible time layer determines 12/24-hour formatting; designs without one use 24-hour time.

Garmin controls the update schedule and whether always-on is enabled. Its [AMOLED watch-face guidelines](https://developer.garmin.com/connect-iq/articles/user-experience-guidelines/Watch_Faces.html) recommend gray, minimizing static elements, and movement; the [watch-face entry-point documentation](https://developer.garmin.com/connect-iq/articles/user-experience-guidelines/Entry_Points.html) describes pixel and burn-in restrictions. See the [WatchFace lifecycle API](https://developer.garmin.com/connect-iq/api-docs/Toybox/WatchUi/WatchFace.html) for the sleep callbacks. This conservative rendering still needs target-device simulation and physical always-on verification.

## Validation boundary

Automated tests cover all profile IDs and dimensions, shared Solar profile mapping, color validation and monochrome conversion, round-template placement, coordinates and clipping, layer visibility, real data APIs, fixed pixel captions, AOD area/movement, text escaping, app IDs, and complete ZIP extraction with CRC checks.

Generated Minimal Instinct 2, Summit Instinct 3 Solar, and Trail Instinct 3 AMOLED source projects passed actual **generic compilation with Garmin SDK 9.2.0**, covering both display paths. Generic compilation emits missing-device-profile warnings and gradual container-type warnings. Its generic `.prg` output is a syntax/API check and is **not a device-installable build**. The initial generic validation had no authenticated profiles. After the user signed in to SDK Manager, device-specific Solar 3 builds and a font/geometry probe succeeded with the official profile; the first corrected face runs in the simulator. Other targets still need device-specific compilation and simulation. Physical watch appearance, analog-hand visibility where applicable, always-on limits, and installation need hardware verification.
