# Possible next additions

The current application includes the Instinct Connect IQ family, adaptive MIP/AMOLED layouts, portable data-only share codes, an instance template gallery, source exports, automated native SDK setup, compilation/signing, independent captions, metric/imperial unit preferences, marquee multi-selection with alignment and even spacing, and a searchable 96-element catalog. These are possible next additions.

## First: make the preview match the watch

- **Measure more device masks and subscreens.** Solar 3 circle geometry, bezel exclusion, and optional inset guides are implemented. Measure authenticated E-series profiles and refine the conservative main-display masks for other models.
- **Garmin font previews for the main display.** Circular windows already share exact compact glyphs with exported source. Render main-display device font metrics, offer supported glyphs, and add saved stress scenarios for long values, missing data, and date strings.
- **Simulator integration.** Launch the matching Garmin simulator after a build and bring its screenshot into the editor. Compilation, diagnostics, bounded execution, and private signing-key storage are implemented.
- **Device validation fixtures.** Save simulator screenshots for the starter templates and compare future exports against known layouts. Include on-watch checks for readable text and subscreen placement.

[Garmin export and device support](GARMIN.md) records the current device assumptions and links to the official documentation. Expansion should start with Garmin's [compatible device list](https://developer.garmin.com/connect-iq/compatible-devices/) and the installed SDK profiles. Instinct 3 Solar and AMOLED variants, E, and Crossover are now included. Additional Garmin families would need their own geometry, fonts, data support, and power behavior.

## Make designing quicker

- **Saved groups and alignment guides.** Marquee selection, Shift selection, rigid group movement, edge/center alignment, even gap spacing, and bulk actions are implemented. Add persistent named groups and snapping to useful reference points.
- **Small graphs and trends.** Progress bars/rings and custom goals are implemented. Add heart-rate history and compact activity trends, with clear behavior when data is unavailable.
- **Saved metric presets.** Reuse preferred labels, units, time formats, and font choices. Face-level units already support mixed metric/imperial choices. Add reusable style and goal presets.
- **Reusable components.** Save a favorite clock or activity cluster and insert it into another design.
- **More preview scenarios.** Save sets such as a low-battery day, a high-activity day, and missing readings. Test the longest expected value automatically.

## Make sharing and running it easier

- **Community discovery.** Add search, tags, attribution, and version history to the existing code-based templates. An optional hosted index could help discovery while keeping imported templates strictly data-only.
- **Optional cloud sync.** Add accounts, private collections, and version history for people who want the same faces across browsers or machines.
- **Collection backups.** Export and restore a whole collection from the UI, with scheduled backups as an optional self-hosting feature.
- **Store publishing assistance.** Help prepare metadata, screenshots, and review checks after compilation and physical device testing are reliable. Local USB installation guidance is built in.

## Keep the watch efficient

- **Power and update budgets.** Estimate work per redraw, warn about expensive features, and validate generated faces against each target's memory and update constraints.
- **Always-on and low-power previews.** Where a target supports them, design separate active and low-power layouts and verify the allowed update regions and cadence in its SDK profile.
- **Explicit data costs.** Make clear which features read recorded values and which would require sensors or communications, so a designer can understand the battery tradeoff before exporting.

Preview fidelity and SDK validation would add the most confidence first. Alignment tools, small graphs, and reusable metric presets would then make everyday design work faster.
