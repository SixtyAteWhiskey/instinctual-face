import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES } from '../web/devices.js';
import { createProject } from '../web/model.js';
import { displayGeometry, constrainElement, analyzeElement, isElementSafe, pixelRectangle } from '../web/display-safety.js';

test('Solar physical window uses SDK coordinates and a separate opaque bezel', () => {
  const geometry = displayGeometry('instinct3solar50mm');
  assert.deepEqual([geometry.subscreen.x, geometry.subscreen.y, geometry.subscreen.width, geometry.subscreen.height], [113, 0, 62, 62]);
  assert.deepEqual([geometry.subscreen.cx, geometry.subscreen.cy, geometry.subscreen.radius], [144, 31, 31]);
  assert.equal(geometry.margin, 3);
  assert.equal(geometry.subscreen.safeRadius, 28);
  assert.equal(geometry.subscreen.bezelRadius, 44);
  assert.equal(geometry.subscreen.approximate, false);
  assert.equal(displayGeometry('instincte40mm').subscreen.approximate, true);
  assert.equal(displayGeometry('instinctcrossover').subscreen, null);
});

test('the secondary window fits every rectangle corner, including captions', () => {
  const original = { x: 114, y: 15, width: 60, height: 32, fontSize: 24, type: 'steps' };
  assert.equal(isElementSafe(original, 'instinct3solar50mm'), false);
  const fitted = constrainElement(original, 'instinct3solar50mm');
  const pixels = pixelRectangle(fitted);
  const geometry = displayGeometry('instinct3solar50mm');
  assert.equal(isElementSafe(fitted, 'instinct3solar50mm'), true);
  assert.equal(isElementSafe(pixels, 'instinct3solar50mm'), true);
  assert.equal(analyzeElement(fitted, 'instinct3solar50mm').region, 'subscreen');
  assert.equal(fitted.fontSize, original.fontSize);
  assert.ok(fitted.width < 50);
  assert.equal(fitted.height, original.height);
  assert.ok(Math.hypot(fitted.width / 2, fitted.height / 2) <= geometry.subscreen.safeRadius);
  assert.equal(original.width, 60);
  assert.equal(analyzeElement(original, 'instinct3solar50mm').changed, true);
});

test('subscreen text prioritizes caption height while shapes retain proportions', () => {
  const metric = { x: 117.5, y: 15, width: 53, height: 32, type: 'steps' };
  const fitted = constrainElement(metric, 'instinct3solar50mm');
  assert.equal(fitted.height, 32);
  assert.ok(fitted.width >= 45 && fitted.width < 46);
  const shape = constrainElement({ ...metric, type: 'circle' }, 'instinct3solar50mm');
  assert.ok(Math.abs(shape.width / shape.height - metric.width / metric.height) < 0.01);
  assert.equal(isElementSafe(fitted, 'instinct3solar50mm'), true);
});

test('the main screen moves text away from the window bezel and rounded edges', () => {
  const behindBezel = { x: 90, y: 39, width: 32, height: 24 };
  assert.equal(analyzeElement(behindBezel, 'instinct3solar50mm').region, 'main');
  assert.equal(isElementSafe(behindBezel, 'instinct3solar50mm'), false);
  const fitted = constrainElement(behindBezel, 'instinct3solar50mm');
  assert.equal(isElementSafe(fitted, 'instinct3solar50mm'), true);
  assert.equal(fitted.width, behindBezel.width);
  assert.equal(fitted.height, behindBezel.height);
  assert.equal(isElementSafe(constrainElement({ x: 0, y: 0, width: 40, height: 20 }, 'instinct3solar50mm'), 'instinct3solar50mm'), true);
});

test('margin opt-out preserves positions in the original rectangular canvas', () => {
  const layer = { x: 114, y: 15, width: 60, height: 32, fontSize: 24 };
  assert.deepEqual(constrainElement(layer, 'instinct3solar50mm', { safetyMargin: false }), layer);
  assert.equal(displayGeometry('instinct3solar50mm', { safetyMargin: false }).subscreen.safeRadius, 31);
  assert.equal(isElementSafe(layer, 'instinct3solar50mm', { safetyMargin: false }), true);
  assert.deepEqual(constrainElement({ x: -1, y: 999, width: 40, height: 20 }, 'instinct3solar50mm', { safetyMargin: false }), { x: 0, y: 156, width: 40, height: 20 });
});

test('large round-display layers shrink to fit all four corners', () => {
  const fullScreen = { x: 0, y: 0, width: 390, height: 390, fontSize: 50 };
  const fitted = constrainElement(fullScreen, 'instinct3amoled45mm');
  assert.equal(isElementSafe(fitted, 'instinct3amoled45mm'), true);
  assert.ok(fitted.width < 276);
  assert.equal(fitted.width, fitted.height);
  assert.ok(displayGeometry('instinct3amoled45mm').margin > 6);
});

test('new starter geometry is safe on every supported profile', () => {
  for (const id of Object.keys(DEVICES)) for (const template of ['summit', 'minimal', 'trail']) {
    for (const element of createProject(template, id).elements) {
      assert.equal(isElementSafe(element, id), true, `${id} ${template} ${element.type}`);
      assert.equal(isElementSafe(pixelRectangle(element), id), true, `${id} ${template} ${element.type} pixels`);
    }
  }
});

test('bounded layer sizes and positions find a safe placement without mutating inputs', () => {
  for (const [id, device] of Object.entries(DEVICES)) {
    for (let index = 0; index < 60; index++) {
      const width = 3 + ((index * 37) % (device.width - 3));
      const height = 3 + ((index * 19) % (device.height - 3));
      const element = { width, height, x: (index * 23) % Math.max(1, device.width - width), y: (index * 41) % Math.max(1, device.height - height), fontSize: 20 };
      const snapshot = { ...element };
      const fitted = constrainElement(element, id);
      assert.equal(isElementSafe(fitted, id), true, `${id} layer ${index}`);
      assert.equal(isElementSafe(pixelRectangle(fitted), id), true, `${id} pixel layer ${index}`);
      assert.deepEqual(element, snapshot);
    }
  }
});
