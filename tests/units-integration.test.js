import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement, createProject, DEVICES, elementSample, normalizeProject, resizeProject } from '../web/model.js';
import { METRIC_UNITS, IMPERIAL_UNITS, canonicalUnitSample, formatUnitSample } from '../web/units.js';
import { captionStyle } from '../web/pixel-font.js';
import { renderFaceMarkup } from '../web/preview.js';
import { sampleProgress } from '../web/graphics-elements.js';
import { generateGarminFiles } from '../web/garmin-export.js';
import { encodeShareCode, decodeShareCode, validateDesignData } from '../web/sharing.js';

const payload = code => JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString('utf8'));
const envelope = data => {
  const bytes = Buffer.from(JSON.stringify(data));
  return `IF1.${bytes.toString('base64url')}.${createHash('sha256').update(bytes).digest('hex')}`;
};

test('unit preferences remain face-specific and portable through device changes, JSON, source export and sharing', async () => {
  const face = createProject('trail', 'instinct3solar50mm');
  const otherFace = createProject('trail', 'instinct3solar50mm');
  face.settings.units = { temperature: 'f', distance: 'mi', elevation: 'ft', speed: 'kn', pressure: 'mmhg', weight: 'lb', height: 'ftin' };
  const clean = normalizeProject(face);
  const restored = validateDesignData(JSON.parse(JSON.stringify(clean)));
  const portable = await decodeShareCode(await encodeShareCode(restored));
  const onAmoled = resizeProject(portable, 'instinct3amoled50mm');
  assert.deepEqual(onAmoled.settings.units, face.settings.units);
  assert.equal(Object.hasOwn(otherFace.settings, 'units'), false);
  const files = generateGarminFiles(onAmoled);
  assert.deepEqual(JSON.parse(files['design.instinctual.json']).settings.units, face.settings.units);
  assert.deepEqual(portable.settings.units, restored.settings.units);
});

test('legacy templates omit unit settings and preserve deterministic share payloads', async () => {
  const face = createProject('trail', 'instinct3solar50mm');
  assert.equal(Object.hasOwn(face.settings, 'units'), false);
  const first = await encodeShareCode(face);
  const second = await encodeShareCode(normalizeProject(JSON.parse(JSON.stringify(face))));
  assert.equal(second, first);
  assert.equal(Object.hasOwn(payload(first).settings, 'units'), false);
  const decoded = await decodeShareCode(first);
  assert.equal(Object.hasOwn(decoded.settings, 'units'), false);
  const distance = decoded.elements.find(element => element.type === 'distance');
  assert.deepEqual(elementSample(distance, { distance: 5.2 }, decoded.settings.units), { primary: '5.2', label: 'KM' });
});

test('default captions follow display units while explicit wording and hidden captions survive every artifact', async () => {
  const face = createProject('minimal', 'instinct3amoled50mm');
  const distance = createElement('distance', face.device);
  face.elements = [distance];
  face.settings.units = { distance: 'mi' };
  const before = structuredClone(distance);
  assert.deepEqual(elementSample(distance, { distance: 5.2 }, face.settings.units), { primary: '3.2', label: 'MI' });
  assert.equal(captionStyle(distance, DEVICES[face.device], face.settings.units).text, 'MI');
  distance.labelText = 'TRAIL TOTAL';
  assert.equal(elementSample(distance, { distance: 5.2 }, face.settings.units).label, 'TRAIL TOTAL');
  assert.equal(captionStyle(distance, DEVICES[face.device], face.settings.units).text, 'TRAIL TOTAL');
  assert.match(generateGarminFiles(face)['source/InstinctualFaceView.mc'], /TRAIL TOTAL/);
  const portable = await decodeShareCode(await encodeShareCode(face));
  assert.equal(portable.elements[0].labelText, 'TRAIL TOTAL');
  assert.equal(portable.elements[0].fontSize, before.fontSize);
  assert.equal(portable.elements[0].width, before.width);
  distance.labelText = '';
  assert.equal(elementSample(distance, { distance: 5.2 }, face.settings.units).label, '');
  assert.equal(captionStyle(distance, DEVICES[face.device], face.settings.units).text, '');
});

test('switching displayed distance units leaves physical progress targets and graphic output unchanged', async () => {
  const face = createProject('minimal', 'instinct3solar50mm');
  const progress = { ...createElement('progressRing', face.device), source: 'distance', goal: 16.09 };
  face.elements = [progress];
  const samples = { distance: 8.045 };
  const before = structuredClone(face);
  const metricImage = renderFaceMarkup(face, { editor: false, samples });
  face.settings.units = { ...IMPERIAL_UNITS };
  assert.equal(sampleProgress(progress, samples).fraction, 0.5);
  assert.equal(renderFaceMarkup(face, { editor: false, samples }), metricImage);
  const portable = await decodeShareCode(await encodeShareCode(face));
  assert.equal(portable.elements[0].goal, before.elements[0].goal);
  assert.equal(sampleProgress(portable.elements[0], samples).fraction, 0.5);
});

test('representative canonical readings produce selected preview values and keep their data when preferences change', () => {
  const readings = [
    ['temperature', -40, '-40', '-40'],
    ['temperatureLow', -0.49, '0', '31'],
    ['sensorTemperature', 29, '29.0', '84.2'],
    ['altitude', -165, '-165', '-541'],
    ['ascent', 100, '100', '328'],
    ['weatherPressure', 1013.25, '1013', '29.92'],
    ['weight', 72.5, '72.5', '159.8'],
    ['userHeight', 182.87, '183', `6'0"`],
    ['racePace5k', '4:50', '4:50', '7:47'],
    ['temperatureRange', '-5 / 22', '-5 / 22', '23 / 72'],
    ['temperatureRange', '-- / 22', '-- / 22', '-- / 72'],
  ];
  for (const [type, value, metric, imperial] of readings) {
    const element = createElement(type, 'instinct3solar50mm');
    const samples = { [type]: value };
    assert.equal(elementSample(element, samples, METRIC_UNITS).primary, metric, type);
    assert.equal(elementSample(element, samples, IMPERIAL_UNITS).primary, imperial, type);
    assert.equal(samples[type], value);
    assert.equal(elementSample(element, { [type]: null }, IMPERIAL_UNITS).primary, '--', type);
  }
});

test('displayed sample inputs convert to metric storage without applying temperature offsets to missing values', () => {
  assert.equal(canonicalUnitSample('temperature', 32, IMPERIAL_UNITS), 0);
  assert.equal(canonicalUnitSample('temperature', '--', IMPERIAL_UNITS), null);
  assert.equal(canonicalUnitSample('temperature', null, IMPERIAL_UNITS), null);
  assert.equal(canonicalUnitSample('distance', 1, IMPERIAL_UNITS), 1.609344);
  assert.ok(Math.abs(canonicalUnitSample('altitude', -100, IMPERIAL_UNITS) + 30.48) < 1e-10);
  const height = canonicalUnitSample('userHeight', `6'0"`, IMPERIAL_UNITS);
  assert.ok(Math.abs(height - 182.88) < 1e-10);
  assert.equal(formatUnitSample('userHeight', height, IMPERIAL_UNITS), `6'0"`);
  assert.equal(formatUnitSample('windSpeed', 18.52, { speed: 'kn' }), '10.0');
  assert.equal(formatUnitSample('windSpeed', 36, { speed: 'ms' }), '10.0');
});

test('template unit choices reject source-like strings, unknown fields and nested accessors before evaluation', async () => {
  const face = createProject();
  const code = await encodeShareCode(face);
  for (const units of [{ temperature: 'f; System.println("injected");' }, { temperature: { code: 'f' } }, { callback: 'eval' }, { distance: 'meters' }]) {
    const data = payload(code);
    data.settings.units = units;
    await assert.rejects(decodeShareCode(envelope(data)), /Unsupported|must|units/i);
  }
  let evaluated = false;
  const units = {};
  Object.defineProperty(units, 'temperature', { enumerable: true, get() { evaluated = true; return 'f'; } });
  face.settings.units = units;
  await assert.rejects(encodeShareCode(face), /ordinary data/i);
  assert.equal(evaluated, false);
});
