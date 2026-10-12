import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES, UNSUPPORTED_DEVICES, TEMPLATE_DEFINITIONS, createProject, createElement, resizeProject, resizeElement, normalizeProject, clampPosition, elementSample } from '../web/model.js';
import { isElementSafe } from '../web/display-safety.js';
import { ELEMENT_TYPE_IDS, ELEMENT_DEFINITIONS, ELEMENT_GROUPS, elementCompatibility, isGraphicElement } from '../web/elements.js';
import { IMPERIAL_UNITS } from '../web/units.js';

test('device dimensions match each Connect IQ viewport', () => {
  assert.deepEqual([DEVICES.instinct2.width, DEVICES.instinct2.height], [176, 176]);
  assert.deepEqual([DEVICES.instinct2s.width, DEVICES.instinct2s.height], [163, 156]);
  assert.deepEqual([DEVICES.instinct2x.width, DEVICES.instinct2x.height], [176, 176]);
  assert.deepEqual([DEVICES.instinct3amoled45mm.width, DEVICES.instinct3amoled45mm.height], [390, 390]);
  assert.deepEqual([DEVICES.instinct3amoled50mm.width, DEVICES.instinct3amoled50mm.height], [416, 416]);
  assert.deepEqual([DEVICES.instincte40mm.width, DEVICES.instincte40mm.height], [166, 166]);
  assert.equal(DEVICES.instinct3solar50mm.id, 'instinct3solar45mm');
  assert.equal(Object.keys(DEVICES).length, 11);
  for (const device of Object.values(DEVICES)) {
    assert.equal(device.supported, true);
    assert.equal(device.fontMax, device.display === 'amoled' ? 512 : 128);
  }
  for (const unsupported of UNSUPPORTED_DEVICES) {
    assert.equal(unsupported.supported, false);
    assert.throws(() => createProject('summit', unsupported.id), /cannot install custom/);
  }
});

test('AMOLED starter layouts remain inside the round display rather than the old subscreen corners', () => {
  for (const device of Object.keys(DEVICES).filter(id => DEVICES[id].shape === 'round')) {
    const radius = DEVICES[device].width / 2;
    for (const template of TEMPLATE_DEFINITIONS) {
      const project = createProject(template.id, device);
      assert.equal(project.background, '#000000');
      for (const layer of project.elements) {
        for (const x of [layer.x, layer.x + layer.width]) {
          for (const y of [layer.y, layer.y + layer.height]) {
            assert.ok(Math.hypot(x - radius, y - radius) <= radius + 0.02, `${device} ${template.id} ${layer.type}`);
          }
        }
      }
    }
  }
});

test('AMOLED accepts and canonicalizes safe full RGB while monochrome remains two-color', () => {
  const project = createProject('summit', 'instinct3amoled45mm');
  project.background = '#ABCDEF';
  project.elements[0].color = '#12AB34';
  project.elements[0].fontSize = 512;
  const clean = normalizeProject(project);
  assert.equal(clean.background, '#abcdef');
  assert.equal(clean.elements[0].color, '#12ab34');
  assert.equal(clean.elements[0].fontSize, 512);
  for (const invalid of ['red', '#abc', '#GG0000', '#1234567', '#123456;alert(1)', ' #123456']) {
    assert.throws(() => normalizeProject({ ...project, background: invalid }), /hexadecimal/);
    assert.throws(() => normalizeProject({ ...project, elements: [{ ...project.elements[0], color: invalid }] }), /hexadecimal/);
  }
  assert.throws(() => normalizeProject({ ...createProject(), background: '#123456' }), /monochrome/);
  assert.throws(() => normalizeProject({ ...project, elements: [{ ...project.elements[0], fontSize: 513 }] }), /512/);
  assert.equal(createElement('text', 'instinct3amoled45mm', '#ffffff').color, '#000000');
  assert.equal(createElement('text', 'instinct3amoled45mm', '#000000').color, '#ffffff');
});

test('switching from AMOLED to MIP quantizes brightness and clamps font limits', () => {
  const project = createProject('minimal', 'instinct3amoled50mm');
  project.background = '#ffffff';
  project.elements[0].color = '#ff0000';
  project.elements[1].color = '#00ff00';
  project.elements[2].color = '#0000ff';
  project.elements[0].fontSize = 512;
  const mono = resizeProject(project, 'instinct2');
  assert.equal(mono.background, '#eeeeee');
  assert.deepEqual(mono.elements.map(element => element.color), ['#111111', '#eeeeee', '#111111']);
  assert.equal(mono.elements[0].fontSize, 128);
  assert.doesNotThrow(() => normalizeProject(mono));
  assert.equal(project.background, '#ffffff');
  const restored = resizeProject(mono, 'instinct3amoled50mm');
  assert.doesNotThrow(() => normalizeProject(restored));
  assert.deepEqual(restored.elements.map(element => element.color), mono.elements.map(element => element.color));
});

test('all templates are valid on all supported devices and create independent IDs', () => {
  for (const template of TEMPLATE_DEFINITIONS) {
    for (const device of Object.keys(DEVICES)) {
      const project = createProject(template.id, device);
      assert.deepEqual(normalizeProject(project), project);
      assert.ok(project.elements.length > 0);
      assert.equal(project.device, device);
    }
  }
  const first = createProject();
  const second = createProject();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.elements[0].id, second.elements[0].id);
});

test('all element defaults fit the 2S viewport and honor background contrast', () => {
  for (const type of ['time', 'date', 'steps', 'heart', 'battery', 'calories', 'floors', 'distance', 'text', 'line', 'circle']) {
    const element = createElement(type, 'instinct2s', '#eeeeee');
    assert.equal(element.color, '#111111');
    assert.ok(element.x >= 0 && element.x + element.width <= 163);
    assert.ok(element.y >= 0 && element.y + element.height <= 156);
  }
});

test('new monochrome layers and starter faces reserve room for native fonts and captions', () => {
  const textTypes = ['time', 'date', 'steps', 'heart', 'battery', 'calories', 'floors', 'distance', 'text'];
  for (const [id, device] of Object.entries(DEVICES).filter(([, profile]) => profile.display === 'mip')) {
    const minimumFont = device.minNativeFontHeight ?? 21;
    const assertReadable = element => {
      assert.ok(element.height >= minimumFont + (element.label ? 9 : 1), `${id} ${element.type} native font budget`);
      assert.ok(element.y >= 0 && element.y + element.height <= device.height + 0.01, `${id} ${element.type} vertical bounds`);
    };
    for (const type of textTypes) assertReadable(createElement(type, id));
    for (const template of TEMPLATE_DEFINITIONS) {
      const project = createProject(template.id, id);
      for (const element of project.elements.filter(layer => textTypes.includes(layer.type))) assertReadable(element);
      assert.deepEqual(normalizeProject(project), project);
    }
  }
  for (const id of ['instinct3solar45mm', 'instinct3solar50mm']) {
    assert.equal(createElement('date', id).height, 24);
    assert.equal(createElement('battery', id).height, 32);
    const summit = createProject('summit', id);
    assert.equal(summit.elements.find(element => element.type === 'date').height, 24);
    assert.equal(summit.elements.find(element => element.type === 'steps').height, 32);
    assert.equal(summit.elements.find(element => element.type === 'battery').height, 32);
  }
});

test('Summit heart cluster is centered in known physical subscreens', () => {
  for (const [id, device] of Object.entries(DEVICES).filter(([, profile]) => profile.subscreen)) {
    const heart = createProject('summit', id).elements.find(element => element.type === 'heart');
    assert.ok(Math.abs(heart.x + heart.width / 2 - (device.subscreen.x + device.subscreen.width / 2)) <= 0.01, id);
    assert.ok(Math.abs(heart.y + heart.height / 2 - (device.subscreen.y + device.subscreen.height / 2)) <= 0.01, id);
  }
});

test('Trail native metric rows keep a gap on smaller monochrome displays', () => {
  for (const [id, device] of Object.entries(DEVICES).filter(([, profile]) => profile.display === 'mip')) {
    const trail = createProject('trail', id);
    const upper = trail.elements.filter(element => ['steps', 'heart'].includes(element.type));
    const lower = trail.elements.filter(element => ['distance', 'floors'].includes(element.type));
    assert.ok(Math.max(...upper.map(element => element.y + element.height)) + 1.99 <= Math.min(...lower.map(element => element.y)), id);
    assert.ok(Math.max(...lower.map(element => element.y + element.height)) <= device.height + 0.01, id);
  }
});

test('native starter budgets do not rewrite explicit geometry in an existing design', () => {
  const project = createProject('summit', 'instinct3solar50mm');
  const date = project.elements.find(element => element.type === 'date');
  date.height = 18;
  date.fontSize = 13;
  const battery = project.elements.find(element => element.type === 'battery');
  battery.height = 28;
  const imported = normalizeProject(project);
  assert.equal(imported.elements.find(element => element.type === 'date').height, 18);
  assert.equal(imported.elements.find(element => element.type === 'date').fontSize, 13);
  assert.equal(imported.elements.find(element => element.type === 'battery').height, 28);
  assert.equal(resizeProject(project, 'instinct3solar45mm').elements.find(element => element.type === 'date').height, 18);
});

test('resize scales coordinates and sizes independently by device axis', () => {
  const project = createProject();
  const original = structuredClone(project);
  const resized = resizeProject(project, 'instinct2s');
  const source = project.elements[0];
  const result = resized.elements[0];
  assert.equal(result.x, Math.round(source.x * 163 / 176 * 100) / 100);
  assert.equal(result.y, Math.round(source.y * 156 / 176 * 100) / 100);
  assert.equal(result.width, Math.round(source.width * 163 / 176 * 100) / 100);
  assert.equal(result.height, Math.round(source.height * 156 / 176 * 100) / 100);
  assert.equal(result.id, source.id);
  assert.deepEqual(project, original);
  assert.equal(normalizeProject(resized).device, 'instinct2s');
});

test('clampPosition handles rectangular bounds, snapping and unclipped edge placement', () => {
  const element = { width: 30, height: 25 };
  assert.deepEqual(clampPosition(element, -30, 999, { width: 163, height: 156 }), { x: 0, y: 131 });
  assert.deepEqual(clampPosition(element, 13, 15, 176), { x: 12, y: 16 });
  assert.deepEqual(clampPosition(element, 13.5, 15.25, 176, false), { x: 13.5, y: 15.25 });
  assert.deepEqual(clampPosition({ width: 200, height: 200 }, 20, 20, 176), { x: 0, y: 0 });
});

test('resizing preserves valid limits for thin shapes and oversized font settings', () => {
  const project = createProject('minimal', 'instinct2s');
  project.elements[0].fontSize = 128;
  project.elements.push({ ...createElement('line', 'instinct2s'), height: 1 });
  const resized = resizeProject(project, 'instinct2');
  assert.equal(resized.elements[0].fontSize, 128);
  assert.doesNotThrow(() => normalizeProject(resized));
  assert.doesNotThrow(() => normalizeProject(resizeProject(resized, 'instinct2s')));
});

test('switching through the rectangular 2S viewport preserves font sizes on round trips', () => {
  for (const template of TEMPLATE_DEFINITIONS) {
    const original = createProject(template.id, 'instinct2');
    let resized = original;
    for (let switchCount = 0; switchCount < 10; switchCount++) {
      resized = resizeProject(resizeProject(resized, 'instinct2s'), 'instinct2');
    }
    for (let index = 0; index < original.elements.length; index++) {
      assert.ok(Math.abs(resized.elements[index].fontSize - original.elements[index].fontSize) <= 0.02,
        `${template.id} ${original.elements[index].type} font size should survive device switching`);
    }
  }
});

test('import strips unknown fields and controls while preserving supported properties', () => {
  const project = createProject('minimal');
  project.name = '  My\u0000 design  ';
  project.injected = '<script>';
  project.elements[0].onClick = 'bad';
  project.elements[0].locked = true;
  project.settings.extra = true;
  const clean = normalizeProject(project);
  assert.equal(clean.name, 'My design');
  assert.equal(clean.injected, undefined);
  assert.equal(clean.elements[0].onClick, undefined);
  assert.equal(clean.elements[0].locked, true);
  assert.equal(clean.settings.extra, undefined);
});

test('import custom text is bounded and remains plain text', () => {
  const project = createProject();
  const text = createElement('text');
  text.text = `<img src=x onerror=alert(1)>${'X'.repeat(150)}`;
  project.elements.push(text);
  const clean = normalizeProject(project);
  assert.equal(clean.elements.at(-1).text.length, 120);
  assert.ok(clean.elements.at(-1).text.startsWith('<img'));
});

test('import removes noncharacters that would invalidate an SVG text export', () => {
  const project = createProject();
  project.elements.push({ ...createElement('text'), text: 'SAFE\ufffe\uffff TEXT' });
  assert.equal(normalizeProject(project).elements.at(-1).text, 'SAFE TEXT');
});

test('import supplies safe optional defaults and accepts empty layouts', () => {
  const clean = normalizeProject({ version: 1, device: 'instinct2', background: '#111111', elements: [] });
  assert.equal(clean.name, 'Untitled face');
  assert.equal(clean.settings.snap, true);
  assert.equal(clean.settings.grid, false);
  assert.equal(clean.settings.zoom, 1);
  assert.equal(clean.elements.length, 0);
  assert.ok(clean.id);
});

test('import rejects invalid root structures, devices, versions, and element types', () => {
  for (const input of [null, [], 'design', { version: 2 }, { ...createProject(), device: '__proto__' }]) {
    assert.throws(() => normalizeProject(input));
  }
  const project = createProject();
  project.elements[0].type = 'script';
  assert.throws(() => normalizeProject(project), /unsupported type/);
});

test('import rejects non-finite numbers, invalid booleans, and off-screen geometry', () => {
  for (const [field, value] of [['fontSize', NaN], ['x', Infinity], ['width', -1], ['y', '12'], ['visible', 'false'], ['width', 999], ['color', 'red'], ['align', 'baseline'], ['format', 'long']]) {
    const project = createProject();
    project.elements.find(element => element.type === 'time')[field] = value;
    assert.throws(() => normalizeProject(project));
  }
  const outside = createProject();
  outside.elements[0].x = 170;
  assert.throws(() => normalizeProject(outside), /outside/);
});

test('import rejects duplicate IDs, excessive elements, unsafe IDs and invalid settings', () => {
  const duplicate = createProject();
  duplicate.elements[1].id = duplicate.elements[0].id;
  assert.throws(() => normalizeProject(duplicate), /unique ID/);
  const excessive = createProject();
  excessive.elements = Array.from({ length: 101 }, () => createElement('text'));
  assert.throws(() => normalizeProject(excessive), /at most 100/);
  assert.throws(() => normalizeProject({ ...createProject(), id: '../escape' }), /IDs/);
  assert.throws(() => normalizeProject({ ...createProject(), settings: { zoom: 999 } }), /Zoom/);
  assert.throws(() => normalizeProject({ ...createProject(), modifiedAt: 'invalid' }), /valid date/);
});

test('clock and activity samples support preview overrides and conditional labels', () => {
  const clock = createElement('time');
  clock.format = '12h';
  clock.label = true;
  assert.deepEqual(elementSample(clock, { hour: 0, minute: 5 }), { primary: '12:05', label: 'TIME' });
  assert.deepEqual(elementSample(clock, { hour: 15, minute: 2 }), { primary: '3:02', label: 'TIME' });
  assert.deepEqual(elementSample(createElement('battery'), { battery: 120 }), { primary: '100%', label: 'BATTERY' });
  assert.deepEqual(elementSample(createElement('steps'), { steps: 12456 }), { primary: '12,456', label: 'STEPS' });
  assert.deepEqual(elementSample(createElement('date')), { primary: 'SUN 11 OCT', label: '' });
});

test('explicit unavailable preview readings retain captions for every data metric', () => {
  for (const type of ELEMENT_TYPE_IDS.filter(type => !['time', 'date', 'text'].includes(type) && !isGraphicElement(type))) {
    const element = createElement(type);
    for (const missing of [null, '--']) {
      assert.deepEqual(elementSample(element, { [type]: missing }), { primary: '--', label: ELEMENT_DEFINITIONS[type].label }, type);
      assert.deepEqual(elementSample({ ...element, labelText: 'MY READING' }, { [type]: missing }), { primary: '--', label: 'MY READING' }, type);
      assert.deepEqual(elementSample({ ...element, label: false }, { [type]: missing }), { primary: '--', label: '' }, type);
    }
  }
});

test('absent readings still show defaults and unavailable flags do not replace time or custom text', () => {
  assert.deepEqual(elementSample(createElement('heart'), {}), { primary: '68', label: 'BPM' });
  assert.deepEqual(elementSample(createElement('battery'), {}), { primary: '82%', label: 'BATTERY' });
  assert.deepEqual(elementSample(createElement('steps'), {}), { primary: '8,462', label: 'STEPS' });
  assert.equal(elementSample(createElement('stress'), {}).primary, ELEMENT_DEFINITIONS.stress.sample);
  assert.equal(elementSample(createElement('heart'), Object.create({ heart: null })).primary, '68');
  assert.deepEqual(elementSample(createElement('time'), { time: null }), { primary: '10:09', label: '' });
  assert.deepEqual(elementSample(createElement('date'), { date: '--' }), { primary: 'SUN 11 OCT', label: '' });
  assert.deepEqual(elementSample({ ...createElement('text'), text: 'HELLO' }, { text: null }), { primary: 'HELLO', label: '' });
  assert.deepEqual(elementSample(createElement('progressBar'), { progressBar: null }), { primary: '', label: '' });
});

test('unknown creation inputs return understandable errors', () => {
  assert.throws(() => createElement('__unsupported__'), /Unsupported element type/);
  assert.throws(() => createProject('unknown'), /template/);
  assert.throws(() => resizeProject(createProject(), 'instinct3'), /supported/);
});

test('a single dimension resize scales text and keeps direct font editing independent', () => {
  const text = { ...createElement('text', 'instinct3amoled45mm'), x: 120, y: 130, width: 100, height: 60, fontSize: 20 };
  assert.equal(resizeElement(text, { width: 150 }, 'instinct3amoled45mm').fontSize, 30);
  assert.equal(resizeElement(text, { height: 90 }, 'instinct3amoled45mm').fontSize, 30);
  assert.equal(resizeElement(text, { width: 150, height: 30 }, 'instinct3amoled45mm').fontSize, 10);
  assert.equal(resizeElement(text, { width: 50 }, 'instinct3amoled45mm').fontSize, 10);
  assert.equal(text.fontSize, 20);
  const circle = { ...text, type: 'circle' };
  assert.equal(resizeElement(circle, { width: 150 }, 'instinct3amoled45mm').fontSize, 20);
});

test('resizing circle-window text scales its font into the fitted rectangle', () => {
  const text = { ...createElement('steps', 'instinct3solar50mm'), x: 124, y: 19, width: 40, height: 24, fontSize: 20 };
  const resized = resizeElement(text, { width: 62, height: 40 }, 'instinct3solar50mm');
  assert.equal(isElementSafe(resized, 'instinct3solar50mm'), true);
  assert.ok(resized.fontSize < 31);
  assert.ok(resized.fontSize >= 4);
  const free = resizeElement(text, { width: 52 }, 'instinct3solar50mm', { safetyMargin: false });
  assert.equal(free.width, 52);
  assert.equal(free.fontSize, 26);
});

test('safety margin defaults on, stays optional for legacy designs, and accepts only booleans', () => {
  assert.equal(createProject().settings.safetyMargin, true);
  const legacy = createProject();
  delete legacy.settings.safetyMargin;
  const original = structuredClone(legacy.elements);
  assert.equal(normalizeProject(legacy).settings.safetyMargin, true);
  assert.deepEqual(normalizeProject(legacy).elements, original);
  legacy.settings.safetyMargin = false;
  assert.equal(normalizeProject(legacy).settings.safetyMargin, false);
  for (const value of ['false', 0, null, {}, []]) {
    assert.throws(() => normalizeProject({ ...legacy, settings: { ...legacy.settings, safetyMargin: value } }), /Safety margin/);
  }
});

test('caption overrides stay independent when primary text or its box is resized', () => {
  const layer = { ...createElement('heart', 'instinct3amoled45mm'), labelText: 'PULSE 1', labelFontSize: 10, labelColor: '#aBcDeF', labelAlign: 'right', labelGap: 4 };
  const project = createProject('minimal', 'instinct3amoled45mm');
  project.elements = [layer];
  const clean = normalizeProject(project).elements[0];
  assert.equal(clean.labelColor, '#abcdef');
  assert.deepEqual(elementSample(clean), { primary: '68', label: 'PULSE 1' });
  const resized = resizeElement(clean, { width: clean.width * 1.3 }, project.device);
  assert.equal(resized.labelFontSize, 10);
  assert.equal(resized.labelGap, 4);
  assert.equal(resized.labelAlign, 'right');
  assert.equal(resized.labelColor, '#abcdef');
  assert.notEqual(resized.fontSize, clean.fontSize);
  assert.equal(createElement('heart').labelFontSize, undefined);
  assert.equal(normalizeProject(createProject()).elements[0].labelColor, undefined);
  assert.equal(elementSample({ ...clean, labelText: '' }).label, '');
  assert.equal(elementSample({ ...clean, label: false }).label, '');
});

test('caption overrides scale between device pixels and quantize to monochrome colors', () => {
  const project = createProject('minimal', 'instinct2');
  project.elements[0] = { ...project.elements[0], labelText: 'CHARGE %', labelFontSize: 10, labelColor: '#eeeeee', labelAlign: 'left', labelGap: 4 };
  const amoled = resizeProject(project, 'instinct3amoled45mm');
  assert.equal(amoled.elements[0].labelFontSize, 22.16);
  assert.equal(amoled.elements[0].labelGap, 9);
  assert.equal(amoled.elements[0].labelAlign, 'left');
  amoled.elements[0].labelColor = '#aabbcc';
  assert.equal(resizeProject(amoled, 'instinct2').elements[0].labelColor, '#eeeeee');
});

test('caption fields reject malformed values and keep custom text as literal data', () => {
  const base = createProject();
  const cases = [['labelText', null], ['labelFontSize', 4], ['labelFontSize', Infinity], ['labelGap', 1.5], ['labelGap', 33], ['labelColor', 'url(javascript:alert(1))'], ['labelAlign', 'baseline']];
  for (const [field, value] of cases) assert.throws(() => normalizeProject({ ...base, elements: [{ ...base.elements[0], [field]: value }] }), /Caption/);
  const literal = normalizeProject({ ...base, elements: [{ ...base.elements[0], label: true, labelText: '<script>alert(1)</script>' }] });
  assert.equal(literal.elements[0].labelText, '<script>alert(1)</script>');
  assert.equal(elementSample(literal.elements[0]).label, '<script>alert(1)</script>');
  assert.throws(() => normalizeProject({ ...base, elements: [{ ...createElement('circle'), labelFontSize: 5 }] }), /Graphic/);
});

test('every catalog element creates valid independent data on all supported displays', () => {
  const groupIds = new Set(ELEMENT_GROUPS.map(group => group.id));
  assert.equal(ELEMENT_TYPE_IDS.length, 96);
  for (const [type, definition] of Object.entries(ELEMENT_DEFINITIONS)) {
    assert.ok(groupIds.has(definition.group), type);
    assert.ok(definition.name && typeof definition.sample === 'string' && typeof definition.label === 'string', type);
    for (const device of Object.keys(DEVICES)) {
      const project = createProject('minimal', device);
      project.elements = [createElement(type, device, project.background)];
      assert.doesNotThrow(() => normalizeProject(project), `${type} ${device}`);
      assert.equal(isElementSafe(project.elements[0], device), true, `${type} ${device}`);
      assert.equal(elementCompatibility(type, DEVICES[device]).available, true);
    }
  }
  assert.equal(isGraphicElement('progressRing'), true);
  assert.equal(isGraphicElement('battery'), false);
  assert.match(elementCompatibility('sensorTemperature', DEVICES.instinct3solar50mm).note, /body heat/);
  assert.match(elementCompatibility('nextEvent', DEVICES.instinct2).note, /Legacy/);
  assert.deepEqual(elementSample(createElement('bodyBattery'), { bodyBattery: '99' }), { primary: '99', label: 'BODY BATT' });
});

test('graphic design fields accept only bounded values and trusted source or icon names', () => {
  const project = createProject();
  for (const [type, field, value] of [['rectangle', 'filled', 'true'], ['rectangle', 'strokeWidth', 25], ['rectangle', 'cornerRadius', -1], ['progressBar', 'source', 'javascript:evil'], ['progressRing', 'source', null], ['progressRing', 'goal', -1], ['progressBar', 'goal', Infinity], ['icon', 'icon', '../file'], ['icon', 'icon', null]]) {
    assert.throws(() => normalizeProject({ ...project, elements: [{ ...createElement(type), [field]: value }] }), undefined, `${type}.${field}`);
  }
  assert.equal(createElement('progressBar').goal, 0);
  assert.equal(createElement('progressBar').strokeWidth, 1);
  assert.equal(createElement('progressRing').strokeWidth, 3);
});

test('unit preferences stay optional, preserve partial choices through device resizing, and reject malformed data', () => {
  const project = createProject();
  assert.equal(Object.hasOwn(normalizeProject(project).settings, 'units'), false);
  project.settings.units = { temperature: 'f', elevation: 'ft' };
  assert.deepEqual(normalizeProject(project).settings.units, project.settings.units);
  assert.deepEqual(resizeProject(project, 'instinct3amoled50mm').settings.units, project.settings.units);
  for (const units of [null, [], { temperature: 'fahrenheit' }, { source: '<script>' }, { distance: 1 }]) {
    assert.throws(() => normalizeProject({ ...project, settings: { ...project.settings, units } }), /Units|unit/i);
  }
  let called = false;
  const settings = { ...project.settings };
  Object.defineProperty(settings, 'units', { enumerable: true, get() { called = true; return IMPERIAL_UNITS; } });
  assert.throws(() => normalizeProject({ ...project, settings }), /Units/);
  assert.equal(called, false);
});

test('distance progress goals preserve canonical precision across normalization', () => {
  const project = createProject();
  project.elements = [{ ...createElement('progressRing'), source: 'distance', goal: 0.01609344 }];
  assert.equal(normalizeProject(project).elements[0].goal, 0.016093);
  assert.equal(normalizeProject(project).elements[0].source, 'distance');
});
