import test from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_DEFINITIONS, METRIC_UNITS, IMPERIAL_UNITS, normalizeUnits, resolveUnits, unitCategory, unitCaption, conversion, formatUnitSample, canonicalUnitSample } from '../web/units.js';
import { ELEMENT_DEFINITIONS } from '../web/elements.js';
import { createElement, elementSample } from '../web/model.js';
import { sampleProgress } from '../web/graphics-elements.js';

test('unit preference defaults and presets cover only fixed supported choices', () => {
  assert.equal(UNIT_DEFINITIONS.length, 7);
  assert.deepEqual(resolveUnits(), METRIC_UNITS);
  assert.deepEqual(resolveUnits({ temperature: 'f' }), { ...METRIC_UNITS, temperature: 'f' });
  assert.deepEqual(normalizeUnits({ temperature: 'f' }), { temperature: 'f' });
  assert.equal(normalizeUnits(), undefined);
  assert.deepEqual(resolveUnits(IMPERIAL_UNITS), IMPERIAL_UNITS);
  for (const definition of UNIT_DEFINITIONS) {
    assert.ok(definition.options.some(([id]) => id === METRIC_UNITS[definition.category]));
    assert.ok(definition.options.some(([id]) => id === IMPERIAL_UNITS[definition.category]));
  }
});

test('unit preferences reject unknown keys, values, prototypes, getters and hidden fields without execution', () => {
  let called = false;
  const accessor = Object.defineProperty({}, 'temperature', { enumerable: true, get() { called = true; return 'f'; } });
  const cases = [null, [], 'f', 1, { temperature: 'F' }, { temperature: null }, { speed: 'm/s' }, { distance: 'miles' },
    { command: 'shell()' }, { [Symbol('temperature')]: 'f' }, Object.create({ temperature: 'f' }), accessor,
    Object.defineProperty({}, 'temperature', { value: 'f' }), JSON.parse('{"__proto__":{"polluted":true}}')];
  for (const input of cases) assert.throws(() => normalizeUnits(input), /Units|unit/i);
  assert.equal(called, false);
  assert.deepEqual(normalizeUnits(Object.assign(Object.create(null), { temperature: 'f' })), { temperature: 'f' });
  assert.equal({}.polluted, undefined);
});

test('temperature conversions handle Celsius/Fahrenheit, ranges, negatives and independent missing sides', () => {
  assert.equal(formatUnitSample('temperature', 18, IMPERIAL_UNITS), '64');
  assert.equal(formatUnitSample('sensorTemperature', 29, IMPERIAL_UNITS), '84.2');
  assert.equal(formatUnitSample('temperature', -40, IMPERIAL_UNITS), '-40');
  assert.equal(formatUnitSample('temperature', -0.1, METRIC_UNITS), '0');
  assert.equal(formatUnitSample('temperature', -0.5, METRIC_UNITS), '-1');
  assert.equal(formatUnitSample('temperature', 0.5, METRIC_UNITS), '1');
  assert.equal(formatUnitSample('temperatureRange', '9 / 22', IMPERIAL_UNITS), '48 / 72');
  assert.equal(formatUnitSample('temperatureRange', '-- / 22', IMPERIAL_UNITS), '-- / 72');
  assert.equal(formatUnitSample('temperatureRange', '9 / --', IMPERIAL_UNITS), '48 / --');
  assert.equal(canonicalUnitSample('temperature', '68', IMPERIAL_UNITS), 20);
  assert.equal(canonicalUnitSample('temperatureRange', '-- / 68', IMPERIAL_UNITS), '-- / 20');
});

test('distance, elevation and predicted pace conversions share a precise canonical basis', () => {
  assert.equal(formatUnitSample('distance', 5.2, IMPERIAL_UNITS), '3.2');
  assert.equal(formatUnitSample('weeklyRun', 24.8, IMPERIAL_UNITS), '15.4');
  assert.equal(formatUnitSample('weeklyBike', 82.5, IMPERIAL_UNITS), '51.3');
  assert.equal(formatUnitSample('visibility', 16, IMPERIAL_UNITS), '9.9');
  assert.equal(formatUnitSample('altitude', '1,650', IMPERIAL_UNITS), '5,413');
  assert.equal(formatUnitSample('altitude', -165, IMPERIAL_UNITS), '-541');
  assert.equal(formatUnitSample('ascent', 145, IMPERIAL_UNITS), '476');
  assert.equal(formatUnitSample('descent', 130, IMPERIAL_UNITS), '427');
  assert.equal(formatUnitSample('racePace5k', '4:50', IMPERIAL_UNITS), '7:47');
  assert.equal(formatUnitSample('racePace5k', '4:20', IMPERIAL_UNITS), '6:58');
  assert.equal(canonicalUnitSample('racePace5k', '7:47', IMPERIAL_UNITS), '4:50');
  assert.equal(canonicalUnitSample('distance', '1', IMPERIAL_UNITS), 1.609344);
  assert.equal(canonicalUnitSample('altitude', '1', IMPERIAL_UNITS), 0.3048);
  assert.equal(conversion('distance', IMPERIAL_UNITS).factor, 1 / 1.609344);
});

test('wind, pressure, weight and height conversions use their selected precision', () => {
  assert.equal(formatUnitSample('windSpeed', 12, { speed: 'mph' }), '7.5');
  assert.equal(formatUnitSample('windSpeed', 12, { speed: 'kn' }), '6.5');
  assert.equal(formatUnitSample('windSpeed', 12, { speed: 'ms' }), '3.3');
  assert.equal(formatUnitSample('windSpeed', 12, { speed: 'kmh' }), '12');
  assert.equal(formatUnitSample('pressure', 1013, { pressure: 'inhg' }), '29.91');
  assert.equal(formatUnitSample('weatherPressure', 1013, { pressure: 'mmhg' }), '759.8');
  assert.equal(formatUnitSample('weight', 72.5, IMPERIAL_UNITS), '159.8');
  assert.equal(formatUnitSample('userHeight', 178, IMPERIAL_UNITS), '5\'10"');
  assert.equal(formatUnitSample('userHeight', 71.5 * 2.54, IMPERIAL_UNITS), '6\'0"');
  assert.equal(canonicalUnitSample('userHeight', '5\'10"', IMPERIAL_UNITS), 177.8);
  assert.equal(canonicalUnitSample('userHeight', '5 ft 10 in', IMPERIAL_UNITS), 177.8);
  assert.equal(canonicalUnitSample('userHeight', '70', IMPERIAL_UNITS), 177.8);
  for (const [type, value, units] of [['temperature', 20, { temperature: 'f' }], ['distance', 8, { distance: 'mi' }], ['windSpeed', 12, { speed: 'kn' }], ['weight', 72.5, { weight: 'lb' }], ['pressure', 1013, { pressure: 'inhg' }]]) {
    const { factor, offset } = conversion(unitCategory(type), units);
    assert.ok(Math.abs(canonicalUnitSample(type, value * factor + offset, units) - value) < 1e-9);
  }
});

test('missing readings stay missing and untrusted sample text never becomes a number', () => {
  for (const type of ['temperature', 'distance', 'altitude', 'pressure', 'weight', 'userHeight', 'racePace5k', 'temperatureRange']) {
    for (const value of [null, undefined, '--', '', NaN, Infinity, '<script>', '20 C', '1,2', {}, []]) assert.equal(formatUnitSample(type, value, IMPERIAL_UNITS), '--', `${type} ${String(value)}`);
    for (const value of [null, undefined, '--', '']) assert.equal(canonicalUnitSample(type, value, IMPERIAL_UNITS), null);
    for (const value of ['javascript:1', 'abc', NaN, Infinity]) assert.throws(() => canonicalUnitSample(type, value, IMPERIAL_UNITS), /valid number/);
  }
  assert.throws(() => canonicalUnitSample('userHeight', '5\'99"', IMPERIAL_UNITS), /valid number/);
  assert.throws(() => canonicalUnitSample('racePace5k', '4:60', IMPERIAL_UNITS), /valid number/);
});

test('metric default captions stay compatible, selected units update only automatic captions', () => {
  for (const [type, definition] of Object.entries(ELEMENT_DEFINITIONS)) assert.equal(unitCaption(type), definition.label, type);
  assert.equal(unitCaption('distance', IMPERIAL_UNITS), 'MI');
  assert.equal(unitCaption('temperature', IMPERIAL_UNITS), 'TEMP F');
  assert.equal(unitCaption('altitude', IMPERIAL_UNITS), 'ALTITUDE FT');
  assert.equal(unitCaption('racePaceHalf', IMPERIAL_UNITS), 'HALF MIN/MI');
  assert.equal(unitCaption('pressure', IMPERIAL_UNITS), 'PRESS INHG');
  assert.equal(unitCaption('visibility', IMPERIAL_UNITS), 'VIS MI');
  const distance = createElement('distance');
  assert.deepEqual(elementSample(distance, { distance: 5.2 }, IMPERIAL_UNITS), { primary: '3.2', label: 'MI' });
  assert.deepEqual(elementSample({ ...distance, labelText: 'KM' }, { distance: 5.2 }, IMPERIAL_UNITS), { primary: '3.2', label: 'KM' });
  assert.equal(elementSample({ ...distance, labelText: '' }, {}, IMPERIAL_UNITS).label, '');
  assert.deepEqual(elementSample({ ...createElement('temperature'), labelText: 'AIR' }, { temperature: null }, IMPERIAL_UNITS), { primary: '--', label: 'AIR' });
  assert.deepEqual(elementSample(createElement('temperature'), { temperature: '--' }, IMPERIAL_UNITS), { primary: '--', label: 'TEMP F' });
});

test('changing units never changes canonical progress ratios or user target values', () => {
  const ring = { ...createElement('progressRing'), source: 'distance', goal: 1.609344 };
  const samples = { distance: 0.804672 };
  assert.equal(elementSample(createElement('distance'), samples, IMPERIAL_UNITS).primary, '0.5');
  assert.equal(sampleProgress(ring, samples).fraction, 0.5);
  assert.equal(sampleProgress(ring, samples).goal, 1.609344);
  assert.equal(elementSample(createElement('distance'), samples, METRIC_UNITS).primary, '0.8');
  assert.equal(sampleProgress(ring, samples).fraction, 0.5);
});
