import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES } from '../web/devices.js';
import { createProject } from '../web/model.js';
import { analyzeElement, constrainElement, displayGeometry, isElementSafe } from '../web/display-safety.js';
import { effectiveElement } from '../web/preview.js';
import { moveSelection, selectionBounds, selectionIds, selectionRect } from '../web/selection.js';

const layer = (id, x, y, width = 10, height = 10, properties = {}) => ({ id, type: 'text', x, y, width, height,
  fontSize: 21, labelFontSize: 7, labelGap: 3, visible: true, locked: false, ...properties });
const bezelDevice = { width: 200, height: 200, shape: 'semi-octagon', displayCornerCut: 0.05, hasSubscreen: true,
  subscreen: { x: 90, y: 90, width: 20, height: 20 }, subscreenBezel: 5 };

test('marquee normalizes all drag directions and rejects nonfinite coordinates', () => {
  for (const [start, end] of [[{ x: 12, y: 9 }, { x: 40, y: 30 }], [{ x: 40, y: 30 }, { x: 12, y: 9 }],
    [{ x: 40, y: 9 }, { x: 12, y: 30 }], [{ x: 12, y: 30 }, { x: 40, y: 9 }]]) {
    assert.deepEqual(selectionRect(start, end), { x: 12, y: 9, width: 28, height: 21 });
  }
  assert.throws(() => selectionRect({ x: NaN, y: 0 }, { x: 2, y: 3 }), /finite/);
  assert.throws(() => selectionRect({ x: 0, y: 0 }, { x: Infinity, y: 3 }), /finite/);
});

test('marquee selects intersecting visible bounds, locked layers, edge touches, and lines', () => {
  const elements = [layer('inside', 15, 15), layer('overlap', 5, 5), layer('touch', 30, 20),
    layer('outside', 31, 20), layer('hidden', 15, 15, 10, 10, { visible: false }),
    layer('locked', 15, 15, 10, 10, { locked: true }), layer('horizontal', 5, 23, 40, 0),
    layer('vertical', 22, 5, 0, 40), layer('invalid', NaN, 15)];
  assert.deepEqual(selectionIds(elements, { x: 10, y: 10, width: 20, height: 20 }),
    ['inside', 'overlap', 'touch', 'locked', 'horizontal', 'vertical']);
  assert.deepEqual(selectionIds(elements, { x: NaN, y: 0, width: 10, height: 10 }), []);
});

test('selection bounds ignore hidden and malformed layers but include locked layers', () => {
  assert.equal(selectionBounds([]), null);
  assert.deepEqual(selectionBounds([layer('a', 10, 20), layer('b', 40, 15, 5, 20, { locked: true }),
    layer('hidden', 0, 0, 100, 100, { visible: false }), layer('bad', 0, 0, -1, 10)]),
  { x: 10, y: 15, width: 35, height: 20 });
});

test('a selection moves rigidly and snaps the translation rather than each position', () => {
  const elements = [layer('a', 10.5, 20.25), layer('b', 45.75, 50.5)];
  const before = structuredClone(elements);
  const moved = moveSelection(elements, 'instinct2', 6, 10, { safetyMargin: false, snap: true });
  assert.equal(moved.changed, true);
  assert.deepEqual([moved.dx, moved.dy], [8, 12]);
  assert.ok(Math.abs(moved.elements[1].x - moved.elements[0].x - (elements[1].x - elements[0].x)) < 1e-9);
  assert.equal(moved.elements[1].y - moved.elements[0].y, elements[1].y - elements[0].y);
  for (const [index, item] of moved.elements.entries()) {
    for (const property of ['width', 'height', 'fontSize', 'labelFontSize', 'labelGap']) assert.equal(item[property], elements[index][property]);
  }
  assert.deepEqual(elements, before);
  assert.notEqual(moved.elements, elements);
  assert.notEqual(moved.elements[0], elements[0]);
});

test('common viewport limits preserve positions within a group', () => {
  const elements = [layer('a', 10, 20), layer('b', 80, 30)];
  const moved = moveSelection(elements, 'instinct2', 1000, -1000, { safetyMargin: false });
  assert.deepEqual([moved.dx, moved.dy], [86, -20]);
  assert.deepEqual(moved.elements.map(item => [item.x, item.y]), [[96, 0], [166, 10]]);
});

test('locked and hidden layers stay fixed and do not restrict movable layers', () => {
  const elements = [layer('a', 40, 90), layer('locked', 0, 0, 176, 176, { locked: true }),
    layer('hidden', 0, 0, 176, 176, { visible: false })];
  const moved = moveSelection(elements, 'instinct2', 4, 3);
  assert.deepEqual([moved.dx, moved.dy], [4, 3]);
  assert.equal(moved.elements[1], elements[1]);
  assert.equal(moved.elements[2], elements[2]);
  assert.equal(moveSelection(elements.slice(1), 'instinct2', 4, 3).changed, false);
});

test('empty, invalid numeric, and impossible starting selections remain unchanged', () => {
  for (const elements of [[], [layer('bad', NaN, 0)], [layer('huge', 0, 0, 300, 300)]]) {
    assert.deepEqual(moveSelection(elements, 'instinct2', 4, 3), { elements, dx: 0, dy: 0, changed: false });
  }
  const elements = [layer('a', 40, 90)];
  for (const [dx, dy] of [[NaN, 3], [4, Infinity]]) assert.equal(moveSelection(elements, 'instinct2', dx, dy).changed, false);
  assert.equal(moveSelection([layer('unsafe', 0, 0, 20, 20)], 'instinct2', 5, 5).changed, false);
});

test('a safe endpoint across the bezel cannot cause a selection to hop over it', () => {
  const elements = [layer('a', 40, 95, 5, 10), layer('b', 40, 110, 5, 5)];
  assert.ok(elements.every(item => isElementSafe(item, bezelDevice, { region: 'main' })));
  assert.ok(elements.every(item => isElementSafe({ ...item, x: item.x + 100 }, bezelDevice, { region: 'main' })));
  const moved = moveSelection(elements, bezelDevice, 100, 0);
  assert.ok(moved.dx > 30 && moved.dx < 40);
  assert.equal(moved.dy, 0);
  assert.ok(moved.elements.every(item => isElementSafe(item, bezelDevice, { region: 'main' })));
  assert.ok(moved.elements[0].x + moved.elements[0].width < 90);
  assert.equal(moved.elements[1].x - moved.elements[0].x, 0);
  assert.equal(moveSelection(elements, bezelDevice, 100, 0, { safetyMargin: false }).dx, 100);
});

test('subscreen layers retain their display region and limit a mixed selection together', () => {
  const elements = [layer('main', 40, 90), layer('circle', 130, 25, 8, 8)];
  const regions = new Map(elements.map(item => [item.id, analyzeElement(item, 'instinct3solar50mm').region]));
  assert.equal(regions.get('circle'), 'subscreen');
  const moved = moveSelection(elements, 'instinct3solar50mm', 100, 0, { regions });
  assert.ok(moved.dx > 20 && moved.dx < 35);
  assert.ok(Math.abs(moved.elements[1].x - moved.elements[0].x - (elements[1].x - elements[0].x)) < 1e-9);
  for (const item of moved.elements) assert.ok(isElementSafe(item, 'instinct3solar50mm', { region: regions.get(item.id) }));
  assert.deepEqual(moveSelection(elements, 'instinct3solar50mm', 100, 0, { regions: Object.fromEntries(regions) }), moved);
});

test('keyboard-sized translations remain unsnapped and do not change sizes or caption styles', () => {
  const elements = [layer('a', 40, 90), layer('b', 60, 110)];
  const moved = moveSelection(elements, 'instinct2', -1, 0, { snap: false });
  assert.deepEqual([moved.dx, moved.dy], [-1, 0]);
  assert.deepEqual(moved.elements.map(item => [item.width, item.height, item.fontSize, item.labelFontSize, item.labelGap]),
    elements.map(item => [item.width, item.height, item.fontSize, item.labelFontSize, item.labelGap]));
});

test('all 11 profiles constrain common movement without shrinking or splitting the starter layouts', () => {
  assert.equal(Object.keys(DEVICES).length, 11);
  for (const id of Object.keys(DEVICES)) {
    const elements = createProject('summit', id).elements;
    const snapshot = structuredClone(elements);
    const regions = new Map(elements.map(item => [item.id, analyzeElement(item, id).region]));
    for (const [dx, dy] of [[200, 100], [-200, -100], [100, -150], [-100, 150], [1, 0], [0, -1]]) {
      const moved = moveSelection(elements, id, dx, dy, { regions });
      for (const [index, item] of moved.elements.entries()) {
        assert.ok(isElementSafe(item, id, { region: regions.get(item.id) }), `${id} ${item.type} safe`);
        assert.ok(Math.abs(item.x - elements[index].x - moved.dx) < 1e-9, `${id} common x`);
        assert.ok(Math.abs(item.y - elements[index].y - moved.dy) < 1e-9, `${id} common y`);
        assert.equal(item.width, elements[index].width);
        assert.equal(item.height, elements[index].height);
      }
    }
    assert.deepEqual(elements, snapshot);
  }
});

test('100-layer groups remain safe throughout the returned path near rounded edges and bezel', () => {
  for (const id of ['instinct3solar50mm', 'instinct3amoled50mm', 'instinctcrossover']) {
    const geometry = displayGeometry(id);
    const elements = Array.from({ length: 100 }, (_, index) => constrainElement(layer(`layer-${index}`,
      (index * 31) % geometry.width, (index * 17) % geometry.height, 5, 5), id));
    const regions = new Map(elements.map(item => [item.id, analyzeElement(item, id).region]));
    const moved = moveSelection(elements, id, 300, -250, { regions });
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) for (const item of elements) {
      assert.ok(isElementSafe({ ...item, x: item.x + moved.dx * fraction, y: item.y + moved.dy * fraction }, id,
        { region: regions.get(item.id) }), `${id} ${item.id} path ${fraction}`);
    }
  }
});

test('whole-pixel boundary movement preserves effective rendered sizes and group spacing on every profile', () => {
  for (const [id, device] of Object.entries(DEVICES)) {
    const elements = [layer('a', device.width * 0.25, device.height * 0.55, 18, 14),
      layer('b', device.width * 0.25 + 24, device.height * 0.55 + 21, 18, 14)]
      .map(item => effectiveElement(item, device, true));
    const moved = moveSelection(elements, device, 1000, -1000, { wholePixels: true });
    assert.equal(moved.changed, true, `${id} moves toward boundary`);
    assert.ok(Number.isInteger(moved.dx) && Number.isInteger(moved.dy), `${id} integer translation`);
    const rendered = moved.elements.map(item => effectiveElement(item, device, true));
    for (const [index, item] of rendered.entries()) {
      assert.equal(item.width, elements[index].width, `${id} retains width`);
      assert.equal(item.height, elements[index].height, `${id} retains height`);
      assert.equal(item.fontSize, elements[index].fontSize);
      assert.equal(item.labelFontSize, elements[index].labelFontSize);
      assert.ok(isElementSafe(item, device), `${id} safe rendered layer`);
      assert.equal(item.x, moved.elements[index].x, `${id} no preview refit x`);
      assert.equal(item.y, moved.elements[index].y, `${id} no preview refit y`);
    }
    assert.equal(rendered[1].x - rendered[0].x, elements[1].x - elements[0].x, `${id} horizontal spacing`);
    assert.equal(rendered[1].y - rendered[0].y, elements[1].y - elements[0].y, `${id} vertical spacing`);
  }
});

test('whole-pixel translations work for subcircle edges and remain optional for fractional geometry', () => {
  const elements = [layer('a', 130, 25, 8, 8), layer('b', 142, 25, 5, 5)]
    .map(item => effectiveElement(item, DEVICES.instinct3solar50mm, true));
  const moved = moveSelection(elements, 'instinct3solar50mm', 100, 0, { wholePixels: true });
  assert.ok(moved.changed);
  assert.ok(Number.isInteger(moved.dx));
  for (const [index, item] of moved.elements.entries()) {
    assert.deepEqual(effectiveElement(item, DEVICES.instinct3solar50mm, true), item);
    assert.equal(item.width, elements[index].width);
    assert.equal(item.height, elements[index].height);
  }
  const fractional = moveSelection([layer('main', 40, 95, 5, 10)], bezelDevice, 100, 0);
  assert.ok(fractional.changed);
  assert.equal(Number.isInteger(fractional.dx), false);
  assert.deepEqual([moveSelection(elements, 'instinct3solar50mm', 1, 0, { wholePixels: true }).dx,
    moveSelection(elements, 'instinct3solar50mm', 0.4, 0, { wholePixels: true }).dx], [1, 0]);
});
