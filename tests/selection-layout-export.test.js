import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES, createElement, createProject, normalizeProject } from '../web/model.js';
import { effectiveElement, renderFaceMarkup } from '../web/preview.js';
import { arrangeSelection } from '../web/selection.js';
import { generateGarminFiles } from '../web/garmin-export.js';
import { encodeShareCode, decodeShareCode } from '../web/sharing.js';
import { IMPERIAL_UNITS } from '../web/units.js';

function fixture(device) {
  const bounds = DEVICES[device];
  const project = createProject('minimal', device);
  project.name = 'Aligned export';
  project.settings.units = { ...IMPERIAL_UNITS };
  project.elements = [[0.2, 0.6, 15], [0.35, 0.64, 17], [0.6, 0.68, 19]].map(([x, y, width], index) => ({
    ...createElement('text', device), x: Math.round(x * bounds.width), y: Math.round(y * bounds.height),
    width, height: 12, fontSize: 10, text: `VALUE ${index + 1}`, label: true,
    labelText: `CAPTION ${index + 1}`, labelFontSize: 5, labelGap: 1,
  }));
  project.elements.push({ ...createElement('text', device), text: 'LOCKED', x: 40, y: 100,
    width: 18, height: 12, locked: true });
  project.elements.push({ ...createElement('text', device), text: 'HIDDEN', x: 20, y: 80,
    width: 18, height: 12, visible: false });
  return normalizeProject(project);
}

function applyArrangement(project, action) {
  const device = DEVICES[project.device];
  const bases = project.elements.map(element => element.locked || !element.visible
    ? element : effectiveElement(element, device, true));
  const arranged = arrangeSelection(bases, device, action, { safetyMargin: true, wholePixels: true });
  assert.equal(arranged.reason, null, `${project.device}: ${action} is possible`);
  assert.equal(arranged.changed, true, `${project.device}: ${action} changes positions`);
  return { ...project, elements: arranged.elements };
}

async function assertPortableGeometry(project) {
  const normalized = normalizeProject(project);
  assert.deepEqual(normalized, project, `${project.device}: model retains arranged geometry`);
  const decoded = await decodeShareCode(await encodeShareCode(project));
  assert.deepEqual(decoded.elements, project.elements, `${project.device}: share retains arranged geometry`);
  assert.deepEqual(decoded.settings, project.settings, `${project.device}: share retains units and editor settings`);
  const files = generateGarminFiles(project);
  assert.deepEqual(JSON.parse(files['design.instinctual.json']), project,
    `${project.device}: source backup retains the exact design`);
  const source = files['source/InstinctualFaceView.mc'];
  for (const [index, element] of project.elements.entries()) {
    if (!element.visible) continue;
    const nativeLayer = source.split(`// Layer ${index + 1}: text`)[1]?.split('// Layer')[0];
    const draw = /drawLabel\(dc, [^,]+, (\d+), (\d+), (\d+), (\d+),/.exec(nativeLayer);
    assert.ok(draw, `${project.device}: native layer ${index + 1} exists`);
    const rendered = effectiveElement(element, DEVICES[project.device], true);
    assert.deepEqual(draw.slice(1).map(Number), [rendered.x, rendered.y, rendered.width, rendered.height],
      `${project.device}: native and preview use the same arranged bounds`);
  }
  const image = renderFaceMarkup(project, { editor: false,
    selectedIds: project.elements.map(element => element.id), selectionBox: { x: 1, y: 2, width: 30, height: 40 } });
  assert.doesNotMatch(image, /selection-(?:outline|group|marquee)|data-element|data-resize/);
  const portable = JSON.stringify({ design: JSON.parse(files['design.instinctual.json']), shared: decoded });
  assert.doesNotMatch(portable, /selectedIds|selectionBox|layoutAction|layoutTarget|selectionState/);
}

test('aligned geometry persists through model, share and native source export across every profile', async () => {
  for (const device of Object.keys(DEVICES)) {
    const original = fixture(device);
    const project = applyArrangement(original, 'top');
    assert.equal(new Set(project.elements.slice(0, 3).map(element => element.y)).size, 1);
    assert.deepEqual(project.elements.slice(3), original.elements.slice(3), `${device}: protected layers remain unchanged`);
    await assertPortableGeometry(project);
  }
});

test('evenly spaced geometry persists through model, share and native source export across every profile', async () => {
  for (const device of Object.keys(DEVICES)) {
    const original = fixture(device);
    const project = applyArrangement(original, 'spaceX');
    const [first, middle, last] = project.elements;
    const gaps = [middle.x - first.x - first.width, last.x - middle.x - middle.width];
    assert.ok(Math.abs(gaps[0] - gaps[1]) <= 1, `${device}: gaps differ by at most one physical pixel`);
    assert.equal(first.x, original.elements[0].x);
    assert.equal(last.x, original.elements[2].x);
    assert.deepEqual(project.elements.slice(3), original.elements.slice(3), `${device}: protected layers remain unchanged`);
    await assertPortableGeometry(project);
  }
});

test('rejected and repeated no-op arrangements leave portable design bytes unchanged', async () => {
  const project = applyArrangement(fixture('instinct3solar50mm'), 'top');
  const code = await encodeShareCode(project);
  const files = generateGarminFiles(project);
  for (const action of ['top', 'unsupported']) {
    const result = arrangeSelection(project.elements, project.device, action, { wholePixels: true });
    assert.equal(result.changed, false);
    assert.deepEqual(result.elements, project.elements);
    const unchanged = { ...project, elements: result.elements };
    assert.equal(await encodeShareCode(unchanged), code);
    assert.deepEqual(generateGarminFiles(unchanged), files);
  }
});
