/** Shared, dependency-free watch-face model used by the editor and exports. */
import { DEVICES, isDeviceColor, quantizeMonochrome } from './devices.js';
import { constrainElement, displayGeometry } from './display-safety.js';
import { ELEMENT_DEFINITIONS, ELEMENT_TYPE_IDS, isGraphicElement, PROGRESS_SOURCES, ICON_NAMES } from './elements.js';
import { normalizeUnits, unitCaption, unitCategory, formatUnitSample } from './units.js';
export { DEVICES, UNSUPPORTED_DEVICES } from './devices.js';
export { ELEMENT_DEFINITIONS, ELEMENT_TYPE_IDS, isGraphicElement } from './elements.js';

export const TEMPLATE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'summit', name: 'Summit', description: 'An adventure-ready clock with daily essentials.', style: 'adventure' }),
  Object.freeze({ id: 'minimal', name: 'Minimal', description: 'A clean clock with room to breathe.', style: 'minimal' }),
  Object.freeze({ id: 'trail', name: 'Trail', description: 'More activity data at a glance.', style: 'data' }),
]);

const ELEMENT_TYPES = new Set(ELEMENT_TYPE_IDS);
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const FORMATS = new Set(['12h', '24h', 'short', 'long']);
const MAX_ELEMENTS = 100;
const ELEMENT_DEFAULTS = Object.fromEntries(Object.entries(ELEMENT_DEFINITIONS).map(([type, definition]) => [type, definition.defaults]));

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // randomUUID is absent on some non-secure LAN origins; IDs still need to work.
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `face-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getDevice(device) {
  if (!Object.hasOwn(DEVICES, device)) throw new Error('Choose a supported Connect IQ Instinct device. Original Instinct and Instinct Solar cannot install custom Connect IQ faces.');
  return DEVICES[device];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function cleanText(value, fallback, maxLength) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error('Names and custom text must be strings.');
  return value.replace(/[\u0000-\u001f\u007f\ufffe\uffff]/g, '').trim().slice(0, maxLength) || fallback;
}

function identifier(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw new Error('Project and element IDs must contain only letters, numbers, hyphens, and underscores.');
  }
  return value;
}

function numeric(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return round(value);
}

function boolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false.`);
  return value;
}

function captionOverrides(raw, bounds) {
  const result = {};
  if (isGraphicElement(raw.type) && ['labelText', 'labelFontSize', 'labelColor', 'labelAlign', 'labelGap'].some(key => raw[key] !== undefined)) throw new Error('Graphic elements do not support caption overrides.');
  if (raw.labelText !== undefined) {
    if (typeof raw.labelText !== 'string') throw new Error('Caption text must be a string.');
    result.labelText = raw.labelText.replace(/[\u0000-\u001f\u007f\ufffe\uffff]/g, '').trim().slice(0, 32);
  }
  if (raw.labelFontSize !== undefined) result.labelFontSize = numeric(raw.labelFontSize, undefined, 'Caption font size', 5, bounds.maxFontSize);
  if (raw.labelColor !== undefined) {
    if (!isDeviceColor(raw.labelColor, bounds)) throw new Error('Caption color must use a supported #RRGGBB display color.');
    result.labelColor = raw.labelColor.toLowerCase();
  }
  if (raw.labelAlign !== undefined) {
    if (!ALIGNMENTS.has(raw.labelAlign)) throw new Error('Caption alignment must be left, center, or right.');
    result.labelAlign = raw.labelAlign;
  }
  if (raw.labelGap !== undefined) {
    if (!Number.isInteger(raw.labelGap)) throw new Error('Caption gap must be an integer.');
    result.labelGap = numeric(raw.labelGap, undefined, 'Caption gap', 0, 32);
  }
  return result;
}

function graphicProperties(raw, defaults) {
  if (raw.type === 'rectangle') return {
    filled: boolean(raw.filled, defaults.filled, 'Rectangle fill'),
    strokeWidth: numeric(raw.strokeWidth, defaults.strokeWidth, 'Stroke width', 1, 24),
    cornerRadius: numeric(raw.cornerRadius, defaults.cornerRadius, 'Corner radius', 0, 100),
  };
  if (['progressBar', 'progressRing'].includes(raw.type)) {
    const source = raw.source === undefined ? defaults.source : raw.source;
    if (!PROGRESS_SOURCES.includes(source)) throw new Error('Choose a supported progress source.');
    // Distance goals stay in canonical kilometers. Six decimals avoid drift
    // when users enter a small goal in miles and save/import the design.
    const goal = raw.goal === undefined ? defaults.goal : raw.goal;
    numeric(goal, defaults.goal, 'Progress goal', 0, 1000000);
    return { source, goal: source === 'distance' ? Math.round(goal * 1000000) / 1000000 : round(goal), strokeWidth: numeric(raw.strokeWidth, defaults.strokeWidth, 'Stroke width', 1, 24) };
  }
  if (raw.type === 'icon') {
    const icon = raw.icon === undefined ? defaults.icon : raw.icon;
    if (!ICON_NAMES.includes(icon)) throw new Error('Choose a supported icon.');
    return { icon };
  }
  return {};
}

function minimumTextHeight(element, device) {
  if (device.display !== 'mip' || isGraphicElement(element.type)) return 0;
  // Stock bitmap fonts cannot shrink below the watch's native minimum.
  // Metric captions reserve five drawn rows, padding, and a two-pixel gap.
  const fontHeight = device.minNativeFontHeight ?? 21;
  return fontHeight + (element.label ? 9 : 1);
}

/** Creates an element centered on the requested device, with readable defaults. */
export function createElement(type, device = 'instinct2', background = '#111111', { safetyMargin = true } = {}) {
  if (!ELEMENT_TYPES.has(type)) throw new Error(`Unsupported element type: ${type}.`);
  const bounds = getDevice(device);
  const base = ELEMENT_DEFAULTS[type];
  const sx = bounds.width / 176;
  const sy = bounds.height / 176;
  const width = round(base.width * sx);
  const height = round(Math.max(base.height * sy, minimumTextHeight({ type, label: base.label }, bounds)));
  const element = {
    id: makeId(), type,
    x: round((bounds.width - width) / 2), y: round((bounds.height - height) / 2),
    width, height, fontSize: round(base.fontSize * sy),
    align: 'center', color: bounds.display === 'amoled'
      ? (quantizeMonochrome(background) === '#eeeeee' ? '#000000' : '#ffffff')
      : background === '#eeeeee' ? '#111111' : '#eeeeee',
    label: base.label,
    ...(base.text !== undefined ? { text: base.text } : {}),
    ...(base.format !== undefined ? { format: base.format } : {}),
    ...graphicProperties({ type }, base),
    locked: false, visible: true,
  };
  return constrainElement(element, bounds, { safetyMargin });
}

/** Resizing a layer scales its text along the axis the user actually changes. */
export function resizeElement(element, dimensions, device = 'instinct2', options = {}) {
  const bounds = getDevice(typeof device === 'string' ? device : Object.keys(DEVICES).find(id => DEVICES[id] === device));
  const hasWidth = Object.hasOwn(dimensions, 'width');
  const hasHeight = Object.hasOwn(dimensions, 'height');
  const width = hasWidth ? numeric(dimensions.width, element.width, 'Element width', 1, bounds.width) : element.width;
  const height = hasHeight ? numeric(dimensions.height, element.height, 'Element height', 1, bounds.height) : element.height;
  const ratio = hasWidth && hasHeight ? Math.min(width / element.width, height / element.height)
    : hasWidth ? width / element.width : hasHeight ? height / element.height : 1;
  const proposed = { ...element, width, height };
  const fitted = constrainElement(proposed, bounds, options);
  const fitRatio = Math.min(1, fitted.width / width, fitted.height / height);
  return isGraphicElement(element.type) ? fitted
    : { ...fitted, fontSize: round(Math.max(4, Math.min(bounds.maxFontSize, element.fontSize * ratio * fitRatio))) };
}

/** Clamps an element to a square size or a {width, height} device viewport. */
export function clampPosition(element, x, y, bounds = 176, snap = true) {
  const width = typeof bounds === 'number' ? bounds : bounds.width;
  const height = typeof bounds === 'number' ? bounds : bounds.height;
  const maxX = Math.max(0, width - element.width);
  const maxY = Math.max(0, height - element.height);
  let nextX = Number.isFinite(x) ? x : 0;
  let nextY = Number.isFinite(y) ? y : 0;
  if (snap) {
    nextX = Math.round(nextX / 4) * 4;
    nextY = Math.round(nextY / 4) * 4;
  }
  return { x: round(Math.max(0, Math.min(maxX, nextX))), y: round(Math.max(0, Math.min(maxY, nextY))) };
}

/** Converts external JSON into a bounded, whitelisted project; rejects invalid fields. */
export function normalizeProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A design must be a JSON object.');
  if (input.version !== 1) throw new Error('This design version is not supported. Expected version 1.');
  const bounds = getDevice(input.device);
  if (!isDeviceColor(input.background, bounds)) throw new Error(bounds.display === 'amoled' ? 'Background must use #RRGGBB hexadecimal notation.' : 'Background must be #111111 or #eeeeee on monochrome devices.');
  if (!Array.isArray(input.elements) || input.elements.length > MAX_ELEMENTS) {
    throw new Error(`A design must contain an elements array with at most ${MAX_ELEMENTS} elements.`);
  }
  const ids = new Set();
  const elements = input.elements.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !ELEMENT_TYPES.has(raw.type)) {
      throw new Error(`Element ${index + 1} has an unsupported type.`);
    }
    const defaults = createElement(raw.type, input.device, input.background);
    const id = identifier(raw.id, defaults.id);
    if (ids.has(id)) throw new Error('Every element must have a unique ID.');
    ids.add(id);
    const width = numeric(raw.width, defaults.width, 'Element width', 1, bounds.width);
    const height = numeric(raw.height, defaults.height, 'Element height', 1, bounds.height);
    const x = numeric(raw.x, defaults.x, 'Element x', 0, bounds.width);
    const y = numeric(raw.y, defaults.y, 'Element y', 0, bounds.height);
    if (x + width > bounds.width + 0.01 || y + height > bounds.height + 0.01) {
      throw new Error(`Element ${index + 1} extends outside the watch display.`);
    }
    const align = raw.align === undefined ? defaults.align : raw.align;
    const color = raw.color === undefined ? defaults.color : raw.color;
    if (!ALIGNMENTS.has(align)) throw new Error('Element alignment must be left, center, or right.');
    if (!isDeviceColor(color, bounds)) throw new Error(bounds.display === 'amoled' ? 'Element color must use #RRGGBB hexadecimal notation.' : 'Element color must be #111111 or #eeeeee on monochrome devices.');
    if (raw.format !== undefined && !FORMATS.has(raw.format)) throw new Error('Unsupported time or date format.');
    if (raw.format !== undefined && raw.type !== 'time' && raw.type !== 'date') throw new Error('Only clocks and dates support a format.');
    if (raw.type === 'time' && raw.format !== undefined && !['12h', '24h'].includes(raw.format)) throw new Error('Clock format must be 12h or 24h.');
    if (raw.type === 'date' && raw.format !== undefined && !['short', 'long'].includes(raw.format)) throw new Error('Date format must be short or long.');
    return {
      id, type: raw.type, x, y, width, height,
      fontSize: numeric(raw.fontSize, defaults.fontSize, 'Font size', 4, bounds.maxFontSize), align, color: color.toLowerCase(),
      label: boolean(raw.label, defaults.label, 'Element label'),
      ...captionOverrides(raw, bounds),
      ...graphicProperties(raw, defaults),
      ...(raw.type === 'text' ? { text: cleanText(raw.text, 'YOUR TEXT', 120) } : {}),
      ...(defaults.format ? { format: raw.format ?? defaults.format } : {}),
      locked: boolean(raw.locked, false, 'Element lock'),
      visible: boolean(raw.visible, true, 'Element visibility'),
    };
  });
  const settings = input.settings === undefined ? {} : input.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Design settings must be an object.');
  let units;
  if (Object.hasOwn(settings, 'units')) {
    const descriptor = Object.getOwnPropertyDescriptor(settings, 'units');
    if (descriptor.get || descriptor.set || !descriptor.enumerable || descriptor.value === undefined) throw new Error('Units must contain ordinary data fields.');
    units = normalizeUnits(descriptor.value);
  }
  let modifiedAt = new Date().toISOString();
  if (input.modifiedAt !== undefined) {
    if (typeof input.modifiedAt !== 'string' || !Number.isFinite(Date.parse(input.modifiedAt))) throw new Error('Modified date must be a valid date string.');
    modifiedAt = new Date(input.modifiedAt).toISOString();
  }
  return {
    version: 1, id: identifier(input.id, makeId()), name: cleanText(input.name, 'Untitled face', 80),
    device: input.device, background: input.background.toLowerCase(), elements,
    settings: {
      grid: boolean(settings.grid, false, 'Grid'),
      snap: boolean(settings.snap, true, 'Snap'),
      safetyMargin: boolean(settings.safetyMargin, true, 'Safety margin'),
      zoom: numeric(settings.zoom, 1, 'Zoom', 0.5, 1.5),
      ...(units === undefined ? {} : { units }),
    },
    modifiedAt,
  };
}

/** Returns a copy scaled to a different device, preserving element IDs and settings. */
export function resizeProject(project, device) {
  const target = getDevice(device);
  const clean = normalizeProject(project);
  const source = DEVICES[clean.device];
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  return {
    ...clean, device, background: target.display === 'mip' ? quantizeMonochrome(clean.background) : clean.background,
    modifiedAt: new Date().toISOString(),
    elements: clean.elements.map(element => {
      const resized = {
        ...element, width: Math.max(1, Math.min(target.width, round(element.width * sx))),
        height: Math.max(1, Math.min(target.height, round(element.height * sy))),
        fontSize: Math.min(target.maxFontSize, Math.max(4, round(element.fontSize * sy))),
        color: target.display === 'mip' ? quantizeMonochrome(element.color) : element.color,
        ...(element.labelFontSize !== undefined ? { labelFontSize: Math.min(target.maxFontSize, Math.max(5, round(element.labelFontSize * sy))) } : {}),
        ...(element.labelGap !== undefined ? { labelGap: Math.min(32, Math.max(0, Math.round(element.labelGap * sy))) } : {}),
        ...(element.labelColor !== undefined ? { labelColor: target.display === 'mip' ? quantizeMonochrome(element.labelColor) : element.labelColor } : {}),
      };
      return { ...resized, ...clampPosition(resized, element.x * sx, element.y * sy, target, false) };
    }),
  };
}

function templateElement(type, properties) {
  return { ...createElement(type), ...properties };
}

/** Creates a fully independent project from one of the three starter layouts. */
export function createProject(templateId = 'summit', device = 'instinct2') {
  getDevice(device);
  const definition = TEMPLATE_DEFINITIONS.find(template => template.id === templateId);
  if (!definition) throw new Error('Choose a Summit, Minimal, or Trail template.');
  const layouts = {
    summit: [
      templateElement('date', { x: 8, y: 42, width: 80, height: 20, fontSize: 13, align: 'left' }),
      templateElement('heart', { x: 124, y: 17, width: 40, height: 34, fontSize: 23 }),
      templateElement('time', { x: 12, y: 79, width: 152, height: 44, fontSize: 43, align: 'left' }),
      templateElement('line', { x: 28, y: 126, width: 120, height: 1 }),
      templateElement('steps', { x: 34, y: 131, width: 68, height: 30, fontSize: 20, align: 'left' }),
      templateElement('battery', { x: 104, y: 131, width: 38, height: 28, fontSize: 18 }),
    ],
    minimal: [
      templateElement('battery', { x: 125, y: 19, width: 37, height: 29, fontSize: 17, label: false }),
      templateElement('time', { x: 12, y: 68, width: 152, height: 48, fontSize: 43 }),
      templateElement('date', { x: 28, y: 132, width: 120, height: 20, fontSize: 13 }),
    ],
    trail: [
      templateElement('date', { x: 12, y: 36, width: 80, height: 18, fontSize: 12, align: 'left' }),
      templateElement('battery', { x: 123, y: 16, width: 42, height: 33, fontSize: 20, label: false }),
      templateElement('time', { x: 14, y: 60, width: 88, height: 42, fontSize: 36 }),
      templateElement('line', { x: 16, y: 105, width: 144, height: 1 }),
      templateElement('steps', { x: 17, y: 108, width: 72, height: 29, fontSize: 17 }),
      templateElement('heart', { x: 100, y: 108, width: 60, height: 29, fontSize: 17 }),
      templateElement('distance', { x: 46, y: 142, width: 54, height: 27, fontSize: 15 }),
      templateElement('floors', { x: 99, y: 142, width: 31, height: 27, fontSize: 15 }),
    ],
  };
  // Round displays need different placements, not a scaled corner subscreen.
  const roundLayouts = {
    summit: [
      templateElement('heart', { x: 64, y: 20, width: 48, height: 29, fontSize: 22 }),
      templateElement('date', { x: 34, y: 50, width: 108, height: 18, fontSize: 13 }),
      templateElement('time', { x: 12, y: 72, width: 152, height: 44, fontSize: 40 }),
      templateElement('line', { x: 30, y: 120, width: 116, height: 1 }),
      templateElement('steps', { x: 32, y: 127, width: 63, height: 28, fontSize: 20 }),
      templateElement('battery', { x: 101, y: 127, width: 43, height: 28, fontSize: 18 }),
    ],
    minimal: [
      templateElement('battery', { x: 68, y: 28, width: 40, height: 26, fontSize: 17, label: false }),
      templateElement('time', { x: 12, y: 68, width: 152, height: 48, fontSize: 43 }),
      templateElement('date', { x: 34, y: 124, width: 108, height: 20, fontSize: 13 }),
    ],
    trail: [
      templateElement('battery', { x: 66, y: 12, width: 44, height: 24, fontSize: 17, label: false }),
      templateElement('date', { x: 32, y: 35, width: 112, height: 19, fontSize: 13 }),
      templateElement('time', { x: 14, y: 57, width: 148, height: 42, fontSize: 36 }),
      templateElement('line', { x: 30, y: 104, width: 116, height: 1 }),
      templateElement('steps', { x: 27, y: 112, width: 68, height: 27, fontSize: 17 }),
      templateElement('heart', { x: 101, y: 112, width: 48, height: 27, fontSize: 17 }),
      templateElement('distance', { x: 47, y: 143, width: 43, height: 21, fontSize: 15 }),
      templateElement('floors', { x: 98, y: 143, width: 32, height: 21, fontSize: 15 }),
    ],
  };
  const project = {
    version: 1, id: makeId(), name: `${definition.name} face`, device: 'instinct2',
    background: '#111111', elements: (DEVICES[device].shape === 'round' ? roundLayouts : layouts)[templateId],
    settings: { grid: false, snap: true, safetyMargin: true, zoom: 1 }, modifiedAt: new Date().toISOString(),
  };
  const result = device === 'instinct2' ? project : resizeProject(project, device);
  const bounds = DEVICES[device];
  if (bounds.display === 'amoled') result.background = '#000000';
  else {
    // Apply native font budgets only when creating a starter. Existing designs
    // retain their explicit sizes during import, normalization, and resizing.
    result.elements = result.elements.map(element => {
      const sized = { ...element, height: Math.max(element.height, minimumTextHeight(element, bounds)) };
      return { ...sized, ...clampPosition(sized, element.x, element.y, bounds, false) };
    });
    if (templateId === 'summit' && bounds.subscreen) {
      const heart = result.elements.find(element => element.type === 'heart');
      const sub = bounds.subscreen;
      Object.assign(heart, clampPosition(heart,
        sub.x + (sub.width - heart.width) / 2,
        sub.y + (sub.height - heart.height) / 2, bounds, false));
    }
    if (templateId === 'trail') {
      const upper = result.elements.filter(element => ['steps', 'heart'].includes(element.type));
      const lower = result.elements.filter(element => ['distance', 'floors'].includes(element.type));
      const lowerHeight = Math.max(...lower.map(element => element.height));
      const lowerY = Math.min(...lower.map(element => element.y), bounds.height - lowerHeight - displayGeometry(bounds).margin);
      const upperY = Math.min(...upper.map(element => element.y), lowerY - Math.max(...upper.map(element => element.height)) - 2);
      for (const element of lower) element.y = round(lowerY);
      for (const element of upper) element.y = round(upperY);
    }
  }
  result.elements = result.elements.map(element => constrainElement(element, bounds, { safetyMargin: true }));
  return result;
}

/** Returns preview content. Numeric overrides let the editor simulate watch data. */
export function elementSample(element, values = {}, units) {
  const number = (key, fallback) => typeof values[key] === 'number' && Number.isFinite(values[key]) ? values[key] : fallback;
  const withLabel = (primary, label = unitCaption(element.type, units)) => ({ primary: String(primary), label: element.label ? element.labelText ?? label : '' });
  if (!['time', 'date', 'text'].includes(element.type) && !isGraphicElement(element.type) &&
      Object.hasOwn(values, element.type) && (values[element.type] === null || values[element.type] === '--')) {
    return withLabel('--');
  }
  if (unitCategory(element.type)) {
    const value = Object.hasOwn(values, element.type) ? values[element.type] : ELEMENT_DEFINITIONS[element.type]?.sample;
    return withLabel(formatUnitSample(element.type, value, units));
  }
  switch (element.type) {
    case 'time': {
      const hour = ((Math.floor(number('hour', 10)) % 24) + 24) % 24;
      const minute = ((Math.floor(number('minute', 9)) % 60) + 60) % 60;
      const displayedHour = element.format === '12h' ? hour % 12 || 12 : String(hour).padStart(2, '0');
      return withLabel(`${displayedHour}:${String(minute).padStart(2, '0')}`);
    }
    case 'date': {
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const longMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
      const day = Math.min(31, Math.max(1, Math.floor(number('day', 11))));
      const month = Math.min(12, Math.max(1, Math.floor(number('month', 10)))) - 1;
      const weekday = ((Math.floor(number('weekday', 0)) % 7) + 7) % 7;
      return withLabel(element.format === 'long' ? `${longMonths[month]} ${day}` : `${days[weekday]} ${day} ${months[month]}`);
    }
    case 'steps': return withLabel(Math.max(0, Math.floor(number('steps', 8462))).toLocaleString('en-US'), 'STEPS');
    case 'heart': return withLabel(Math.max(0, Math.floor(number('heart', 68))), 'BPM');
    case 'battery': return withLabel(`${Math.min(100, Math.max(0, Math.floor(number('battery', 82))))}%`, 'BATTERY');
    case 'calories': return withLabel(Math.max(0, Math.floor(number('calories', 1248))).toLocaleString('en-US'), 'KCAL');
    case 'floors': return withLabel(Math.max(0, Math.floor(number('floors', 12))), 'FLOORS');
    case 'text': return withLabel(element.text || 'YOUR TEXT');
    default: {
      if (isGraphicElement(element.type)) return { primary: '', label: '' };
      const value = values[element.type];
      return withLabel(typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' ? value : ELEMENT_DEFINITIONS[element.type]?.sample ?? '--');
    }
  }
}
