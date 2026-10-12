# Editing guide

## Add and select elements

- Drag an item from the Elements library onto the watch, or click it to add it.
- Drag selected elements to move them.
- Drag across empty canvas to box-select. Any layer the box touches is selected. Alt-drag starts a selection box anywhere.
- Shift-click on the canvas or in Layers to add an element to the selection or remove it.

Selection is temporary editor state. It isn't saved with faces, exports, or templates.

## Properties

- Set pixel position, width, height, font size, alignment, and color.
- Changing Width or Height scales the primary value. Dragging the corner handle resizes both dimensions. Font size is a separate fine adjustment.
- Under **Caption**, set the words, size, gap, alignment, and color independently. Caption size stays fixed when you resize the box.
- MIP screens use black and white. AMOLED screens support full RGB color.
- Time can be 12-hour or 24-hour. Dates have short and long formats. Data fields have optional captions.

## Layers and groups

Use Layers to select, hide, duplicate, delete, lock, or reorder elements. Locking an element protects its position and style.

A multi-selection shows group bounds and controls to duplicate, delete unlocked layers, lock or unlock, and hide or show. Dragging an unlocked member moves the whole group and keeps its spacing. Locked and hidden members stay in place. Group movement stops at the display and circle boundaries.

## Align and space evenly

- **Align elements** lines up left, right, top, or bottom edges, or horizontal or vertical centers, within the bounds of the visible, unlocked selection.
- **Even spacing** needs at least three movable elements. It makes the horizontal or vertical gaps equal and keeps the first and last elements fixed.

Locked and hidden elements are excluded. Each operation is a single undo step. If an operation would cross a safety boundary or make gaps overlap, it is skipped with an explanation. With the safety margin on, centers and gaps round to whole watch pixels and can be off by one pixel.

## Safety margin and canvas

The safety margin is on by default. Its guides keep layers inside the visible main display and the circular window, away from the opaque bezel. **Fit face** moves elements to their fitted positions. Turn the margin off for free placement. This setting is saved with designs and share codes.

You can also toggle the pixel grid and 4-pixel snapping, change the zoom level, and undo or redo. **Preview** hides the editing controls.

## Units and sample data

**Units** sets temperature, distance and pace, elevation, wind speed, pressure, weight, and height. Pick the Metric or US / imperial preset, or mix individual settings. Your unit choices are saved with the design and share code, and apply to the preview, SVG export, and built watch file.

**Sample data** lets you try different readings and custom distance goals in the selected units. Switching units keeps the same physical values. Preview values are simulated, while the watch face reads real data. When a reading isn't available, the face shows `--`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Arrow keys | Nudge selected visible, unlocked elements by 1 pixel |
| Shift + arrow keys | Nudge by 10 pixels |
| Ctrl / Cmd + Z | Undo |
| Ctrl / Cmd + Shift + Z, or Ctrl / Cmd + Y | Redo |
| Ctrl / Cmd + A | Select all visible layers (Edit view) |
| Shift + click | Add an element to the selection or remove it |
| Ctrl / Cmd + D | Duplicate selection |
| Delete / Backspace | Delete selected unlocked elements |
| Ctrl / Cmd + S | Save now |
| Escape | Clear selection |
