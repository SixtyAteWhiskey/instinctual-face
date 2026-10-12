import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES } from '../web/devices.js';
import { analyzeElement, displayGeometry, isElementSafe } from '../web/display-safety.js';
import { effectiveElement } from '../web/preview.js';
import { arrangeSelection } from '../web/selection.js';

const layer = (id, x, y, width = 10, height = 10, properties = {}) => ({ id, type: 'text', x, y, width, height,
  fontSize: 21, labelFontSize: 7, labelGap: 3, visible: true, locked: false, text: `Custom ${id}`, ...properties });
const flatDevice = { width: 200, height: 200, shape: 'semi-octagon', displayCornerCut: 0, hasSubscreen: false };
const bezelDevice = { width: 200, height: 200, shape: 'semi-octagon', displayCornerCut: 0.05, hasSubscreen: true,
  subscreen: { x: 90, y: 90, width: 20, height: 20 }, subscreenBezel: 5 };
const bounds = [layer('a', 10, 20, 20, 10), layer('b', 70, 80, 10, 30), layer('c', 40, 50, 30, 20)];
const arrangement = (elements, action, options = {}) => arrangeSelection(elements, flatDevice, action, { safetyMargin: false, ...options });

test('all six alignment controls align mixed sizes to their shared selection bounds', () => {
  const expectations = {
    left: [[10, 20], [10, 80], [10, 50]], centerX: [[35, 20], [40, 80], [30, 50]], right: [[60, 20], [70, 80], [50, 50]],
    top: [[10, 20], [70, 20], [40, 20]], centerY: [[10, 60], [70, 50], [40, 55]], bottom: [[10, 100], [70, 80], [40, 90]],
  };
  for (const [action, positions] of Object.entries(expectations)) {
    const result = arrangement(bounds, action);
    assert.equal(result.changed, true, action);
    assert.equal(result.reason, null, action);
    assert.deepEqual(result.elements.map(element => [element.x, element.y]), positions, action);
    for (const [index, element] of result.elements.entries()) {
      const { x, y, ...remaining } = element, { x: oldX, y: oldY, ...original } = bounds[index];
      assert.deepEqual(remaining, original, `${action} preserves dimensions, caption, and custom properties`);
    }
  }
});

test('horizontal spacing equalizes edge gaps, retains endpoints, and preserves element order', () => {
  const elements = [layer('middle', 80, 50, 30, 15), layer('last', 160, 70, 10, 20),
    layer('first', 10, 90, 20, 10), layer('second', 50, 110, 10, 15)];
  const result = arrangement(elements, 'spaceX');
  assert.equal(result.changed, true);
  assert.deepEqual(result.elements.map(element => [element.id, element.x, element.y]),
    [['middle', 100, 50], ['last', 160, 70], ['first', 10, 90], ['second', 60, 110]]);
  assert.equal(result.elements[1], elements[1]);
  assert.equal(result.elements[2], elements[2]);
  const sorted = [...result.elements].sort((a, b) => a.x - b.x);
  const gaps = sorted.slice(1).map((element, index) => element.x - sorted[index].x - sorted[index].width);
  assert.deepEqual(gaps, [30, 30, 30]);
});

test('vertical spacing handles differing heights without changing horizontal positions', () => {
  const elements = [layer('first', 40, 10, 10, 10), layer('middle', 60, 40, 15, 20), layer('last', 80, 140, 20, 30)];
  const result = arrangement(elements, 'spaceY');
  assert.deepEqual(result.elements.map(element => [element.x, element.y]), [[40, 10], [60, 70], [80, 140]]);
  assert.equal(result.elements[0], elements[0]);
  assert.equal(result.elements[2], elements[2]);
});

test('spacing rounds ideal positions once and does not accumulate drift', () => {
  const elements = [layer('a', 10, 40, 7, 5), layer('b', 25, 40, 9, 5), layer('c', 55, 40, 12, 5), layer('d', 100, 40, 8, 5)];
  const result = arrangement(elements, 'spaceX');
  const sorted = result.elements;
  const gaps = sorted.slice(1).map((element, index) => element.x - sorted[index].x - sorted[index].width);
  assert.deepEqual(result.elements.map(element => element.x), [10, 37.67, 67.33, 100]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.011);
  assert.equal(result.elements[0].x, elements[0].x);
  assert.equal(result.elements.at(-1).x, elements.at(-1).x);
  const wholePixels = arrangement(elements, 'spaceX', { wholePixels: true });
  const pixelGaps = wholePixels.elements.slice(1).map((element, index) => element.x - wholePixels.elements[index].x - wholePixels.elements[index].width);
  assert.deepEqual(wholePixels.elements.map(element => element.x), [10, 38, 67, 100]);
  assert.ok(Math.max(...pixelGaps) - Math.min(...pixelGaps) <= 1);
});

test('whole-pixel center alignment rounds odd and even widths within half a pixel', () => {
  const elements = [layer('a', 20, 40, 13, 17), layer('b', 70, 70, 20, 20)];
  for (const action of ['centerX', 'centerY']) {
    const result = arrangement(elements, action, { wholePixels: true });
    assert.ok(result.elements.every(element => Number.isInteger(element.x) && Number.isInteger(element.y)));
    const axis = action === 'centerX' ? 'x' : 'y', size = axis === 'x' ? 'width' : 'height';
    const centers = result.elements.map(element => element[axis] + element[size] / 2);
    assert.ok(Math.abs(centers[0] - centers[1]) <= 0.5);
  }
  const fractional = arrangement([layer('a', 20.25, 40, 13, 10), layer('b', 70.75, 70, 20, 10)], 'left', { wholePixels: true });
  assert.deepEqual(fractional.elements.map(element => element.x), [20, 20]);
});

test('already aligned selections remain exact no-ops without replacing layer objects', () => {
  const elements = [layer('a', 20, 40), layer('b', 20, 70), layer('c', 20, 100)];
  for (const action of ['left', 'centerX', 'right', 'spaceY']) {
    const result = arrangement(elements, action, { wholePixels: true });
    assert.deepEqual(result, { elements, changed: false, reason: null });
    assert.ok(result.elements.every((element, index) => element === elements[index]));
  }
});

test('mixed-parity center alignment is idempotent and never drifts on a second click', () => {
  for (const [action, axis, size] of [['centerX', 'x', 'width'], ['centerY', 'y', 'height']]) {
    const elements = [layer('a', 60, 60), layer('b', 60, 60), layer('c', 60, 60), layer('d', 60, 60)]
      .map((element, index) => ({ ...element, [axis]: [102, 79, 90, 78][index], [size]: [5, 5, 4, 16][index] }));
    const first = arrangement(elements, action, { wholePixels: true });
    assert.equal(first.changed, true);
    assert.deepEqual(first.elements.map(element => element[axis]), [91, 91, 91, 85]);
    const again = arrangement(first.elements, action, { wholePixels: true });
    assert.equal(again.changed, false);
    assert.equal(again.reason, null);
    assert.deepEqual(again.elements, first.elements);
    const centers = first.elements.map(element => element[axis] + element[size] / 2);
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 0.5);
  }
});

test('locked and hidden layers neither move nor contribute alignment reference bounds', () => {
  const elements = [...bounds, layer('locked', 0, 0, 200, 200, { locked: true }),
    layer('hidden', 0, 0, 200, 200, { visible: false }), layer('invalid', NaN, 0)];
  const result = arrangement(elements, 'left');
  assert.deepEqual(result.elements.slice(0, 3).map(element => element.x), [10, 10, 10]);
  for (const index of [3, 4, 5]) assert.equal(result.elements[index], elements[index]);
  const spread = arrangement([layer('a', 10, 40), layer('b', 30, 40), layer('c', 100, 40),
    layer('locked', 0, 0, 200, 200, { locked: true }), layer('hidden', 0, 0, 200, 200, { visible: false })], 'spaceX');
  assert.deepEqual(spread.elements.slice(0, 3).map(element => element.x), [10, 55, 100]);
  assert.equal(spread.elements[3].x, 0);
  assert.equal(spread.elements[4].x, 0);
});

test('insufficient eligible elements and unknown actions return actionable reasons', () => {
  for (const [elements, action, expression] of [[[], 'left', /at least 2/], [bounds.slice(0, 1), 'bottom', /at least 2/],
    [bounds.slice(0, 2), 'spaceX', /at least 3/], [bounds, '__proto__', /supported/], [bounds, 'constructor', /supported/]]) {
    const result = arrangement(elements, action);
    assert.equal(result.changed, false);
    assert.match(result.reason, expression);
    assert.deepEqual(result.elements, elements);
  }
  assert.equal(arrangement([null, undefined, layer('a', 40, 40)], 'left').changed, false);
});

test('viewport rejection also protects stationary spacing endpoints', () => {
  const elements = [layer('first', 10, 40), layer('middle', 30, 40), layer('last', 195, 40)];
  const result = arrangement(elements, 'spaceX');
  assert.equal(result.changed, false);
  assert.match(result.reason, /leave the watch display/);
  assert.deepEqual(result.elements, elements);
});

test('negative gaps reject the whole arrangement while exact touching is allowed', () => {
  const overlap = [layer('a', 10, 40, 30), layer('b', 30, 40, 30), layer('c', 45, 40, 30)];
  const rejected = arrangement(overlap, 'spaceX');
  assert.equal(rejected.changed, false);
  assert.match(rejected.reason, /more room/);
  assert.deepEqual(rejected.elements, overlap);
  const touching = [layer('a', 10, 40, 10), layer('b', 15, 40, 10), layer('c', 30, 40, 10)];
  assert.deepEqual(arrangement(touching, 'spaceX').elements.map(element => element.x), [10, 20, 30]);
});

test('thin lines participate in alignment and edge spacing', () => {
  const elements = [layer('a', 10, 50, 0, 10), layer('b', 30, 70, 10, 0), layer('c', 100, 90, 0, 10)];
  assert.deepEqual(arrangement(elements, 'spaceX').elements.map(element => element.x), [10, 50, 100]);
  assert.deepEqual(arrangement(elements, 'bottom').elements.map(element => element.y + element.height), [100, 100, 100]);
});

test('arrangements are immutable even with frozen layers and preserve custom style data', () => {
  const elements = bounds.map(element => Object.freeze({ ...element, units: 'ft', sampleValue: 123.4, customLabel: 'POWER', color: '#eeeeee' }));
  Object.freeze(elements);
  const before = structuredClone(elements);
  for (const action of ['right', 'spaceX']) {
    const result = arrangement(elements, action);
    assert.equal(result.changed, true);
    assert.notEqual(result.elements, elements);
    assert.deepEqual(elements, before);
    for (const [index, element] of result.elements.entries()) {
      assert.equal(element.width, elements[index].width);
      assert.equal(element.fontSize, elements[index].fontSize);
      assert.equal(element.labelFontSize, elements[index].labelFontSize);
      assert.equal(element.customLabel, 'POWER');
      assert.equal(element.units, 'ft');
    }
  }
});

test('unsafe main-to-circle alignment rejects every move and keeps both original regions', () => {
  const device = 'instinct3solar50mm';
  const elements = [layer('main', 40, 90, 10, 10), layer('circle', 130, 25, 8, 8)];
  const regions = new Map(elements.map(element => [element.id, analyzeElement(element, device).region]));
  assert.deepEqual([...regions.values()], ['main', 'subscreen']);
  for (const action of ['left', 'bottom', 'centerX', 'centerY']) {
    const result = arrangeSelection(elements, device, action, { regions, wholePixels: true });
    assert.equal(result.changed, false, action);
    assert.match(result.reason, /display edge|bezel/, action);
    assert.deepEqual(result.elements, elements);
  }
  for (const action of ['right', 'top']) {
    const result = arrangeSelection(elements, device, action, { regions: Object.fromEntries(regions), wholePixels: true });
    assert.equal(result.changed, true, `${action} remains valid within the original regions`);
    assert.equal(result.reason, null);
    for (const element of result.elements) assert.ok(isElementSafe(element, device, { region: regions.get(element.id) }));
  }
  const disabled = arrangeSelection(elements, device, 'left', { safetyMargin: false, wholePixels: true });
  assert.equal(disabled.changed, true);
  assert.deepEqual(disabled.elements.map(element => element.x), [40, 40]);
});

test('safe endpoint across a bezel is rejected rather than hopping over the circular window', () => {
  const elements = [layer('a', 40, 95, 5, 10), layer('b', 140, 95, 5, 10)];
  assert.ok(elements.every(element => isElementSafe(element, bezelDevice, { region: 'main' })));
  assert.ok(isElementSafe({ ...elements[0], x: 140 }, bezelDevice, { region: 'main' }));
  const result = arrangeSelection(elements, bezelDevice, 'right');
  assert.equal(result.changed, false);
  assert.match(result.reason, /bezel/);
  assert.deepEqual(result.elements, elements);
});

test('safe spacing endpoints cannot hide an unsafe interior destination', () => {
  const elements = [layer('first', 40, 95, 5, 5), layer('middle', 55, 95, 5, 5), layer('last', 160, 95, 5, 5)];
  assert.ok(elements.every(element => isElementSafe(element, bezelDevice, { region: 'main' })));
  const result = arrangeSelection(elements, bezelDevice, 'spaceX');
  assert.equal(result.changed, false);
  assert.match(result.reason, /bezel/);
  assert.deepEqual(result.elements, elements);
});

test('all 11 profiles preserve rendered whole-pixel geometry and regions when arranging safe layers', () => {
  assert.equal(Object.keys(DEVICES).length, 11);
  for (const [id, device] of Object.entries(DEVICES)) {
    const width = Math.round(device.width * 0.06), height = Math.round(device.height * 0.06);
    const elements = [layer('a', Math.round(device.width * 0.25), Math.round(device.height * 0.5), width, height),
      layer('b', Math.round(device.width * 0.40), Math.round(device.height * 0.58), width + 3, height + 3),
      layer('c', Math.round(device.width * 0.65), Math.round(device.height * 0.65), width + 2, height + 2)]
      .map(element => effectiveElement(element, device, true));
    const regions = new Map(elements.map(element => [element.id, analyzeElement(element, device).region]));
    for (const action of ['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'spaceX', 'spaceY']) {
      const result = arrangeSelection(elements, device, action, { wholePixels: true, regions });
      assert.equal(result.reason, null, `${id} ${action} accepted`);
      assert.equal(result.changed, true, `${id} ${action} moves layers`);
      for (const [index, element] of result.elements.entries()) {
        assert.ok(Number.isInteger(element.x) && Number.isInteger(element.y), `${id} ${action} integer target`);
        assert.ok(isElementSafe(element, device, { region: regions.get(element.id) }), `${id} ${action} safe`);
        assert.deepEqual(effectiveElement(element, device, true), element, `${id} ${action} no preview fitting`);
        assert.equal(element.width, elements[index].width);
        assert.equal(element.height, elements[index].height);
        assert.equal(element.fontSize, elements[index].fontSize);
        assert.equal(element.labelFontSize, elements[index].labelFontSize);
      }
    }
    if (displayGeometry(device).subscreen) {
      const sub = displayGeometry(device).subscreen;
      const circleLayers = [layer('s1', Math.round(sub.cx - 10), Math.round(sub.cy - 7), 5, 5),
        layer('s2', Math.round(sub.cx - 2), Math.round(sub.cy + 2), 7, 7),
        layer('s3', Math.round(sub.cx + 7), Math.round(sub.cy + 5), 5, 5)]
        .map(element => effectiveElement(element, device, true));
      const circle = arrangeSelection(circleLayers, device, 'left', { wholePixels: true });
      assert.equal(circle.reason, null, `${id} circle alignment accepted`);
      assert.equal(circle.changed, true);
      for (const element of circle.elements) {
        assert.ok(isElementSafe(element, device, { region: 'subscreen' }));
        assert.deepEqual(effectiveElement(element, device, true), element);
      }
    }
  }
});
