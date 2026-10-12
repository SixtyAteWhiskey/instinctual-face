/** Trusted unit choices. Designs store measurements in canonical metric units. */
import { ELEMENT_DEFINITIONS } from './elements.js';

export const UNIT_DEFINITIONS = Object.freeze([
  { category: 'temperature', label: 'Temperature', options: [['c', 'Celsius (°C)'], ['f', 'Fahrenheit (°F)']] },
  { category: 'distance', label: 'Distance & pace', options: [['km', 'Kilometers / min per km'], ['mi', 'Miles / min per mile']] },
  { category: 'elevation', label: 'Elevation & ascent', options: [['m', 'Meters (m)'], ['ft', 'Feet (ft)']] },
  { category: 'speed', label: 'Wind speed', options: [['kmh', 'Kilometers per hour'], ['mph', 'Miles per hour'], ['kn', 'Knots'], ['ms', 'Meters per second']] },
  { category: 'pressure', label: 'Pressure', options: [['hpa', 'Hectopascals (hPa)'], ['inhg', 'Inches of mercury (inHg)'], ['mmhg', 'Millimeters of mercury (mmHg)']] },
  { category: 'weight', label: 'Weight', options: [['kg', 'Kilograms (kg)'], ['lb', 'Pounds (lb)']] },
  { category: 'height', label: 'Profile height', options: [['cm', 'Centimeters (cm)'], ['ftin', 'Feet & inches']] },
].map(item => Object.freeze({ ...item, options: Object.freeze(item.options.map(option => Object.freeze(option))) })));

export const METRIC_UNITS = Object.freeze({ temperature: 'c', distance: 'km', elevation: 'm', speed: 'kmh', pressure: 'hpa', weight: 'kg', height: 'cm' });
export const IMPERIAL_UNITS = Object.freeze({ temperature: 'f', distance: 'mi', elevation: 'ft', speed: 'mph', pressure: 'inhg', weight: 'lb', height: 'ftin' });
const choices = new Map(UNIT_DEFINITIONS.map(item => [item.category, new Set(item.options.map(([value]) => value))]));
const typesByCategory = {
  temperature: ['temperature', 'feelsLike', 'temperatureHigh', 'temperatureLow', 'dewPoint', 'sensorTemperature', 'temperatureRange'],
  distance: ['distance', 'weeklyRun', 'weeklyBike', 'visibility', 'racePace5k', 'racePace10k', 'racePaceHalf', 'racePaceMarathon'],
  elevation: ['altitude', 'ascent', 'descent'], speed: ['windSpeed'], pressure: ['pressure', 'weatherPressure'], weight: ['weight'], height: ['userHeight'],
};
const categories = new Map(Object.entries(typesByCategory).flatMap(([category, types]) => types.map(type => [type, category])));
const paceTypes = new Set(['racePace5k', 'racePace10k', 'racePaceHalf', 'racePaceMarathon']);

/** Validate only explicitly present choices, preserving legacy absence and partial preferences. */
export function normalizeUnits(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new Error('Units must be a plain data object.');
  }
  const result = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !choices.has(key)) throw new Error(`Unsupported units category: ${String(key)}.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error('Units must contain ordinary data fields.');
    if (!choices.get(key).has(descriptor.value)) throw new Error(`Unsupported ${key} unit.`);
    result[key] = descriptor.value;
  }
  return result;
}

/** Existing designs use metric; the result always includes every supported category. */
export function resolveUnits(input) { return { ...METRIC_UNITS, ...normalizeUnits(input) }; }
export function unitCategory(type) { return categories.get(type) ?? null; }

/** Linear conversion from canonical metric values. Height's ftin value is total inches. */
export function conversion(category, units) {
  const selected = resolveUnits(units)[category];
  if (category === 'temperature') return selected === 'f' ? { factor: 1.8, offset: 32 } : { factor: 1, offset: 0 };
  const factor = {
    distance: { km: 1, mi: 1 / 1.609344 }, elevation: { m: 1, ft: 1 / 0.3048 },
    speed: { kmh: 1, mph: 1 / 1.609344, kn: 1 / 1.852, ms: 1 / 3.6 },
    pressure: { hpa: 1, inhg: 1 / 33.8638866667, mmhg: 1 / 1.33322387415 },
    weight: { kg: 1, lb: 1 / 0.45359237 }, height: { cm: 1, ftin: 1 / 2.54 },
  }[category]?.[selected] ?? 1;
  return { factor, offset: 0 };
}

/** Default captions follow preferences; user-supplied captions are never interpreted. */
export function unitCaption(type, units) {
  const selected = resolveUnits(units), base = ELEMENT_DEFINITIONS[type]?.label ?? '';
  const category = unitCategory(type);
  if (!category || selected[category] === METRIC_UNITS[category]) return base;
  if (category === 'temperature') return base.replace(/ C$/, ` ${selected.temperature.toUpperCase()}`);
  if (category === 'elevation') return base.replace(/ M$/, ` ${selected.elevation.toUpperCase()}`);
  if (paceTypes.has(type)) return base.replace(/MIN\/KM$/, selected.distance === 'mi' ? 'MIN/MI' : 'MIN/KM');
  if (type === 'distance') return selected.distance.toUpperCase();
  if (type === 'visibility') return `VIS ${selected.distance.toUpperCase()}`;
  if (type === 'weeklyRun' || type === 'weeklyBike') return base.replace(/ KM$/, ` ${selected.distance.toUpperCase()}`);
  if (category === 'speed') return `WIND ${selected.speed.toUpperCase()}`;
  if (category === 'pressure') return `${type === 'weatherPressure' ? 'WX' : 'PRESS'} ${selected.pressure.toUpperCase()}`;
  if (category === 'weight') return `WEIGHT ${selected.weight.toUpperCase()}`;
  if (category === 'height') return `HEIGHT ${selected.height === 'ftin' ? 'FT' : 'CM'}`;
  return base;
}

/** Accept finite numeric samples, including existing comma-grouped catalog defaults. */
function sampleNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.length > 128) return null;
  const text = value.trim();
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isFinite(number) ? number : null;
}

// Garmin and JavaScript use the same explicit half-away-from-zero rounding.
function rounded(value, digits = 0) {
  const scale = 10 ** digits;
  const rounded = Math.sign(value) * Math.floor(Math.abs(value) * scale + 0.5 + 1e-9) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function fixed(value, digits = 0) { return rounded(value, digits).toFixed(digits); }
function integer(value) { return rounded(value).toLocaleString('en-US', { maximumFractionDigits: 0, useGrouping: true }); }
function paceSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value * 60 : null;
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = /^(\d{1,7}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function paceText(seconds) {
  seconds = rounded(seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function rangeValues(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const numbers = [];
  for (const part of parts) {
    if (part.trim() === '--' || part.trim() === '') numbers.push(null);
    else {
      const number = sampleNumber(part);
      if (number === null) return null;
      numbers.push(number);
    }
  }
  return numbers;
}

/** Render a canonical metric sample using the same precision as generated watch readers. */
export function formatUnitSample(type, canonicalMetricValue, units) {
  const category = unitCategory(type);
  if (!category) return canonicalMetricValue === null || canonicalMetricValue === undefined ? '--' : String(canonicalMetricValue);
  const selected = resolveUnits(units), { factor, offset } = conversion(category, selected);
  if (type === 'temperatureRange') {
    const range = rangeValues(canonicalMetricValue);
    return range ? range.map(value => value === null ? '--' : fixed(value * factor + offset)).join(' / ') : '--';
  }
  if (paceTypes.has(type)) {
    const seconds = paceSeconds(canonicalMetricValue);
    return seconds === null ? '--' : paceText(seconds / factor);
  }
  const value = sampleNumber(canonicalMetricValue);
  if (value === null) return '--';
  const converted = value * factor + offset;
  if (!Number.isFinite(converted)) return '--';
  if (category === 'temperature') return fixed(converted, type === 'sensorTemperature' ? 1 : 0);
  if (category === 'elevation') return integer(converted);
  if (category === 'distance') return fixed(Math.max(0, converted), 1);
  if (category === 'speed') return fixed(Math.max(0, converted), selected.speed === 'kmh' ? 0 : 1);
  if (category === 'pressure') return fixed(converted, selected.pressure === 'inhg' ? 2 : selected.pressure === 'mmhg' ? 1 : 0);
  if (category === 'weight') return fixed(Math.max(0, converted), 1);
  if (category === 'height') {
    if (selected.height === 'cm') return fixed(Math.max(0, converted));
    const inches = Math.max(0, rounded(converted));
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  }
  return String(converted);
}

/** Convert user-entered displayed samples back to canonical metric storage. */
export function canonicalUnitSample(type, displayedValue, units) {
  const category = unitCategory(type);
  if (!category) return displayedValue;
  if (displayedValue === undefined || displayedValue === null || displayedValue === '--' || typeof displayedValue === 'string' && displayedValue.trim() === '') return null;
  const selected = resolveUnits(units), { factor, offset } = conversion(category, selected);
  const invalid = () => { throw new Error('Enter a valid number in the selected units, or -- for unavailable data.'); };
  if (type === 'temperatureRange') {
    const range = rangeValues(displayedValue);
    return range ? range.map(value => value === null ? '--' : Number(((value - offset) / factor).toFixed(8))).join(' / ') : invalid();
  }
  if (paceTypes.has(type)) {
    const seconds = paceSeconds(displayedValue);
    return seconds === null ? invalid() : paceText(seconds * factor);
  }
  let value;
  if (category === 'height' && selected.height === 'ftin' && typeof displayedValue === 'string') {
    const match = /^\s*(\d{1,3})\s*(?:'|ft)\s*(\d{1,2})\s*(?:"|in)?\s*$/i.exec(displayedValue);
    if (match && Number(match[2]) < 12) value = Number(match[1]) * 12 + Number(match[2]);
  }
  value ??= sampleNumber(displayedValue);
  return value === null || !Number.isFinite((value - offset) / factor) ? invalid() : (value - offset) / factor;
}
