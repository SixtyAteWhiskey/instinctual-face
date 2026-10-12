import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, DEVICES } from '../web/model.js';
import { isElementSafe } from '../web/display-safety.js';
import { effectiveElement, fitPreviewText, renderFaceMarkup } from '../web/preview.js';
import { layoutPixelElement, pixelTextMarkup } from '../web/pixel-font.js';
import { generateGarminFiles } from '../web/garmin-export.js';

test('Solar circle preview and export use identical safe pixel rectangle and glyph cells', () => {
  const face = createProject('summit', 'instinct3solar50mm');
  face.elements = [{ id: 'steps', type: 'steps', x: 118, y: 15, width: 53, height: 32,
    fontSize: 23, label: true, visible: true, color: '#eeeeee', align: 'center' }];
  const original = structuredClone(face);
  const device = DEVICES[face.device];
  const element = effectiveElement(face.elements[0], device);
  assert.ok(isElementSafe(element, device));
  assert.ok(element.width >= 41 && element.width <= 45);
  assert.equal(element.height, 32);
  for (const steps of [0, 12345, 100000, 999999]) {
    const value = steps.toLocaleString('en-US');
    const layout = layoutPixelElement(value, 'STEPS', element, device);
    assert.equal(layout.primaryFit.text, value);
    assert.equal(layout.primaryFit.height, 21);
    const glyphs = pixelTextMarkup(layout.primaryFit, { y: layout.primaryY, boxWidth: element.width, color: element.color });
    assert.ok(renderFaceMarkup(face, { editor: false, samples: { steps } }).includes(glyphs));
    assert.ok(layout.labelY + layout.labelFit.height <= element.height);
  }
  const source = generateGarminFiles(face)['source/InstinctualFaceView.mc'];
  assert.ok(source.includes(`drawLabel(dc, ${element.x + Math.floor(element.width/2)}, ${element.x}, ${element.y}, ${element.width}, ${element.height}, 23,`));
  assert.deepEqual(face, original);
});

test('display masks union the main polygon and circle while excluding its opaque bezel', () => {
  const face = createProject('summit', 'instinct3solar50mm');
  const markup = renderFaceMarkup(face);
  assert.match(markup, /<polygon points=/);
  assert.match(markup, /cx="144" cy="31" r="44" fill="black"/);
  assert.match(markup, /cx="144" cy="31" r="31" fill="white"/);
  assert.match(markup, /class="safety-guide"/);
  const amoled = createProject('summit', 'instinct3amoled50mm');
  const other = renderFaceMarkup(amoled, { editor: false });
  assert.match(other, /cx="208" cy="208" r="208" fill="white"/);
  assert.doesNotMatch(other, /<polygon|safety-guide|data-element|data-resize/);
  assert.notEqual(markup.match(/<mask id="([^"]+)/)[1], other.match(/<mask id="([^"]+)/)[1]);
});

test('safety opt-out preserves positions and removes guides; preview hides editing handles', () => {
  const face = createProject('minimal', 'instinct3solar50mm');
  face.settings.safetyMargin = false;
  face.elements[0].x = 0;
  face.elements[0].y = 0;
  assert.deepEqual(effectiveElement(face.elements[0], DEVICES[face.device], false), face.elements[0]);
  const markup = renderFaceMarkup(face, { selectedId: face.elements[0].id });
  assert.doesNotMatch(markup, /class="safety-guide"/);
  assert.match(markup, /data-resize="true"/);
  assert.doesNotMatch(renderFaceMarkup(face, { preview: true }), /data-resize|data-element|safety-guide/);
});

test('main preview fits both dimensions or uses bounded pixel fallback', () => {
  const device = DEVICES.instinct3solar50mm;
  const layer = { type: 'battery', label: true, color: '#eeeeee', align: 'center', width: 80, height: 32, fontSize: 40 };
  const fit = fitPreviewText({ primary: '100%', label: 'BATTERY' }, layer, device, (text, height) => text.length * height * .45);
  assert.equal(fit.height, 23);
  assert.ok(fit.width <= layer.width);
  assert.ok(fit.labelY + fit.caption.height <= layer.height);
  const fallback = fitPreviewText({ primary: '12345', label: 'BATTERY' }, { ...layer, width: 35, height: 28 }, device, () => 100);
  assert.ok(fallback.pixel.primaryFit.width <= 35);
  assert.ok(fallback.pixel.labelY + fallback.pixel.labelFit.height <= 28);
});

test('custom text and IDs cannot inject markup into an SVG preview', () => {
  const face = createProject('minimal', 'instinct3amoled50mm');
  face.elements = [{ id: '"><script>bad()</script>', type: 'text', text: '<script>alert(1)</script>',
    x: 60, y: 130, width: 290, height: 100, fontSize: 40, visible: true, color: '#eeeeee', align: 'left' }];
  const markup = renderFaceMarkup(face, { measure: () => 10 });
  assert.doesNotMatch(markup, /<script>|onload=/);
  assert.match(markup, /&lt;script&gt;/);
});

test('caption wording, size, alignment and color do not change requested primary style', () => {
  const face = createProject('minimal', 'instinct3amoled50mm');
  const original = { id: 'battery-label', type: 'battery', x: 60, y: 120, width: 200, height: 120,
    fontSize: 40, label: true, visible: true, color: '#ffffff', align: 'center' };
  face.elements = [{ ...original, labelText: 'POWER 2', labelFontSize: 20, labelGap: 5, labelAlign: 'right', labelColor: '#ff7557' }];
  const layer = effectiveElement(face.elements[0], DEVICES[face.device]);
  const layout = layoutPixelElement('82%', 'POWER 2', layer, DEVICES[face.device]);
  assert.equal(layer.fontSize, original.fontSize);
  assert.equal(layer.align, original.align);
  assert.equal(layer.color, original.color);
  assert.equal(layout.labelFit.text, 'POWER 2');
  assert.equal(layout.labelFit.height, 20);
  assert.equal(layout.captionStyle.align, 'right');
  const caption = pixelTextMarkup(layout.labelFit, { y: layout.labelY, boxWidth: layer.width, align: 'right', color: '#ff7557' });
  assert.ok(renderFaceMarkup(face, { editor: false, measure: () => 1000 }).includes(caption));
  face.elements[0].labelText = '';
  const hidden = layoutPixelElement('82%', 'BATTERY', face.elements[0], DEVICES[face.device]);
  assert.equal(hidden.labelFit.height, 0);
  assert.equal(hidden.captionBudget, 0);
});

test('large custom circle captions and values fit without drawing partial glyphs', () => {
  const face = createProject('summit', 'instinct3solar50mm');
  face.elements = [{ id: 'circle-caption', type: 'steps', x: 118, y: 15, width: 53, height: 32,
    fontSize: 23, label: true, labelText: 'DAILY STEP COUNT 2', labelFontSize: 25, labelGap: 2,
    visible: true, color: '#eeeeee', align: 'center', labelAlign: 'left' }];
  const layer = effectiveElement(face.elements[0], DEVICES[face.device]);
  const layout = layoutPixelElement('100,000', face.elements[0].labelText, layer, DEVICES[face.device]);
  assert.ok(layout.captionTruncated);
  assert.ok(layout.labelFit.width <= layer.width);
  assert.ok(layout.primaryFit.width <= layer.width);
  assert.ok(layout.labelY + layout.labelFit.height <= layer.height);
  assert.ok(layout.primaryFit.height >= 7);
  assert.equal(face.elements[0].labelFontSize, 25);
  assert.equal(face.elements[0].fontSize, 23);
  assert.match(renderFaceMarkup(face, { samples: { steps: 100000 } }), /shape-rendering="crispEdges"/);
});

function selectionFace() {
  const face = createProject('minimal', 'instinct3amoled50mm');
  face.settings.safetyMargin = false;
  face.elements = [
    { id: 'first', type: 'battery', x: 40, y: 40, width: 40, height: 30, fontSize: 20, visible: true, color: '#eeeeee', align: 'center' },
    { id: 'second', type: 'steps', x: 120, y: 80, width: 40, height: 30, fontSize: 20, visible: true, color: '#eeeeee', align: 'center' },
    { id: 'hidden', type: 'heartRate', x: 0, y: 0, width: 300, height: 200, fontSize: 20, visible: false, color: '#eeeeee', align: 'center' },
  ];
  return face;
}

test('multiple visible selections have individual outlines and their union, without resize handles', () => {
  const face = selectionFace();
  const original = structuredClone(face);
  const markup = renderFaceMarkup(face, { selectedIds: ['first', 'second', 'hidden', 'unknown'] });
  assert.equal((markup.match(/class="face-element selected"/g) || []).length, 2);
  assert.equal((markup.match(/class="selection-outline"/g) || []).length, 2);
  assert.match(markup, /class="selection-group" x="39" y="39" width="122" height="72"/);
  assert.doesNotMatch(markup, /data-resize|data-element="hidden"|data-element="unknown"/);
  assert.deepEqual(face, original);
});

test('legacy single selection and Set selections work; explicit empty selection clears legacy ID', () => {
  const face = selectionFace();
  const single = renderFaceMarkup(face, { selectedId: 'first' });
  assert.match(single, /data-element="first" class="face-element selected"/);
  assert.equal((single.match(/data-resize="true"/g) || []).length, 1);
  assert.doesNotMatch(single, /selection-group/);
  const set = renderFaceMarkup(face, { selectedIds: new Set(['first', 'second']) });
  assert.equal((set.match(/class="selection-outline"/g) || []).length, 2);
  assert.doesNotMatch(set, /data-resize/);
  const cleared = renderFaceMarkup(face, { selectedId: 'first', selectedIds: [] });
  assert.doesNotMatch(cleared, /face-element selected|selection-outline|selection-group|data-resize/);
});

test('locked selected layers retain their outline but have no resize handle', () => {
  const face = selectionFace();
  face.elements[0].locked = true;
  const single = renderFaceMarkup(face, { selectedIds: ['first'] });
  assert.match(single, /class="face-element selected locked"/);
  assert.match(single, /class="selection-outline"/);
  assert.doesNotMatch(single, /data-resize/);
  const group = renderFaceMarkup(face, { selectedIds: ['first', 'second'] });
  assert.match(group, /class="selection-group"/);
  assert.doesNotMatch(group, /data-resize/);
});

test('a visible layer selected with a hidden layer is a group and has no resize handle', () => {
  const markup = renderFaceMarkup(selectionFace(), { selectedIds: ['first', 'hidden'] });
  assert.match(markup, /data-element="first" class="face-element selected"/);
  assert.doesNotMatch(markup, /data-resize|data-element="hidden"|selection-group/);
});

test('selection outlines follow the same safe geometry as rendered circle pixels', () => {
  const face = createProject('summit', 'instinct3solar50mm');
  const raw = { id: 'circle', type: 'steps', x: 118, y: 15, width: 53, height: 32,
    fontSize: 23, label: true, visible: true, color: '#eeeeee', align: 'center' };
  face.elements = [raw];
  const effective = effectiveElement(raw, DEVICES[face.device]);
  const markup = renderFaceMarkup(face, { selectedIds: ['circle'] });
  assert.ok(markup.includes(`transform="translate(${effective.x} ${effective.y})" data-element="circle" class="face-element selected"`));
  assert.ok(markup.includes(`class="selection-outline" x="-1" y="-1" width="${effective.width+2}" height="${effective.height+2}"`));
  assert.equal(face.elements[0], raw);
});

test('marquee is above display and hit regions, normalizes reverse drags, and clamps to canvas', () => {
  const face = selectionFace();
  const size = DEVICES[face.device];
  const markup = renderFaceMarkup(face, { selectionBox: { x: size.width + 20, y: 100, width: -size.width - 30, height: -150 } });
  assert.match(markup, new RegExp(`class="selection-marquee" x="0" y="0" width="${size.width}" height="100"`));
  assert.match(markup, /class="selection-marquee"[^>]*pointer-events="none"\/>$/);
  assert.ok(markup.lastIndexOf('selection-marquee') > markup.lastIndexOf('data-element='));
  // Overlays follow the closed masked content group, so the marquee can cross the physical bezel.
  assert.match(markup, /<\/g><g transform="translate\(40 40\)" data-element="first"/);
  for (const selectionBox of [null, { x: 0, y: 0, width: 0, height: 30 }, { x: 0, y: 0, width: Infinity, height: 30 }, { x: '<script>', y: 0, width: 30, height: 30 }]) {
    assert.doesNotMatch(renderFaceMarkup(face, { selectionBox }), /selection-marquee|<script>/);
  }
});

test('preview and downloadable SVG omit all selection and marquee editor overlays', () => {
  const face = selectionFace();
  const options = { selectedIds: ['first', 'second'], selectionBox: { x: 0, y: 0, width: 200, height: 200 } };
  for (const mode of [{ preview: true }, { editor: false }, { editor: false, preview: true }]) {
    const markup = renderFaceMarkup(face, { ...options, ...mode });
    assert.doesNotMatch(markup, /selection-outline|selection-group|selection-marquee|face-element|data-element|data-resize/);
    assert.match(markup, /<svg width="40" height="30" overflow="hidden">/);
  }
});
