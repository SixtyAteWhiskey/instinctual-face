/** Trusted graphics shared by the studio preview and generated Monkey C. */
import { PROGRESS_SOURCES, ICON_NAMES } from './elements.js';
export { PROGRESS_SOURCES };
export const PROGRESS_DEFAULT_GOALS = Object.freeze({ steps: 10000, battery: 100, floors: 10, calories: 2000, distance: 10 });
const SAMPLE_VALUES = Object.freeze({ steps: 8462, battery: 82, floors: 12, calories: 1248, distance: 5.2 });
const ICON_SIZE = 12;
const patterns = {
  heart: ['000000000000','001100001100','011110011110','111111111111','111111111111','011111111110','001111111100','000111111000','000011110000','000001100000','000000000000','000000000000'],
  battery: ['000000000000','000000000000','011111111100','010000000110','010110110110','010110110110','010110110110','010000000110','011111111100','000000000000','000000000000','000000000000'],
  steps: ['001100000000','011110000000','011110000000','001100011000','001100111100','011110111100','011110011000','000000011000','000000111100','000000111100','000000000000','000000000000'],
  sun: ['000001100000','001001100100','000100001000','010011110010','000111111000','110111111011','110111111011','000111111000','010011110010','000100001000','001001100100','000001100000'],
  moon: ['000001111000','000111110000','001111000000','011110000000','011100000000','111100000000','111100000000','011110000010','011111000110','001111111100','000111111000','000001110000'],
  cloud: ['000000000000','000000000000','000111100000','001111110000','011111111100','111111111110','111111111111','111111111111','011111111110','000000000000','000000000000','000000000000'],
  rain: ['000000000000','000111100000','001111110000','011111111100','111111111110','111111111111','011111111110','000000000000','001000100100','010001001000','001000100100','010001001000'],
  mountain: ['000000000000','000001000000','000011100000','000110110000','001100011000','001000001000','011000001100','010001000100','110011100110','100110110010','111111111111','000000000000'],
  notification: ['000001100000','000111111000','001100001100','001000000100','001000000100','001000000100','001000000100','011000000110','010000000010','011111111110','000001100000','000000000000'],
  phone: ['000111111000','000100001000','000100001000','000100001000','000100001000','000100001000','000100001000','000100001000','000100001000','000101101000','000111111000','000000000000'],
  bluetooth: ['000001000000','000001100000','000101010000','000011001000','000001010000','000000100000','000001010000','000011001000','000101010000','000001100000','000001000000','000000000000'],
};

// Original fixed masks; templates can choose a name, never supply drawing code.
export const ICON_BITMAPS = Object.freeze(Object.fromEntries(Object.entries(patterns).map(([name, rows]) => {
  if (rows.length !== ICON_SIZE || rows.some(row => !/^[01]{12}$/.test(row))) throw new Error(`Invalid fixed icon mask: ${name}.`);
  return [name, Object.freeze(rows.map(row => Number.parseInt(row, 2)))];
})));
if (ICON_NAMES.length !== Object.keys(ICON_BITMAPS).length || ICON_NAMES.some(name => !Object.hasOwn(ICON_BITMAPS, name))) throw new Error('Icon registry and fixed masks must agree.');
export const ICON_IDS = ICON_NAMES;

function finite(value, fallback, field, min, max) {
  const number = value === undefined ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) throw new TypeError(`Invalid graphics ${field}.`);
  return number;
}

function rectangle(element) {
  return { x: Math.round(finite(element.x, 0, 'x', 0, 10000)), y: Math.round(finite(element.y, 0, 'y', 0, 10000)),
    width: Math.max(1, Math.round(finite(element.width, undefined, 'width', 1, 10000))),
    height: Math.max(1, Math.round(finite(element.height, undefined, 'height', 1, 10000))) };
}

function stroke(element, bounds) {
  return Math.min(Math.min(bounds.width, bounds.height), Math.max(1, Math.round(finite(element.strokeWidth, element.type === 'progressRing' ? 3 : 1, 'stroke width', 1, 24))));
}

function color(element) {
  if (typeof element.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(element.color)) throw new TypeError('Invalid graphics color.');
  return element.color;
}

function source(element) {
  const source = element.source ?? 'steps';
  if (!PROGRESS_SOURCES.includes(source)) throw new TypeError('Unsupported progress source.');
  return source;
}

function customGoal(element) { return finite(element.goal, 0, 'goal', 0, 1000000); }
function iconRows(element) {
  const icon = element.icon ?? 'heart';
  if (!Object.hasOwn(ICON_BITMAPS, icon)) throw new TypeError('Unsupported icon.');
  return ICON_BITMAPS[icon];
}

/** A missing reading is distinct from a valid zero. Invalid goals never divide by zero. */
export function progressFraction(value, goal) {
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof goal !== 'number' || !Number.isFinite(goal) || goal <= 0) return null;
  return Math.max(0, Math.min(1, value / goal));
}

function sampleGoalNumber(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
    value = Number(text.replaceAll(',', ''));
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Distances and their app target are expressed in kilometers. */
export function sampleProgress(element, samples = {}) {
  const key = source(element), target = customGoal(element);
  const value = Object.hasOwn(samples, key) ? samples[key] : SAMPLE_VALUES[key];
  const goalKey = key === 'steps' ? 'stepGoal' : key === 'floors' ? 'floorsGoal' : null;
  const automatic = goalKey ? sampleGoalNumber(samples[goalKey]) : null;
  const goal = key === 'battery' ? 100 : target > 0 ? target
    : automatic ?? PROGRESS_DEFAULT_GOALS[key];
  return { value, goal, fraction: progressFraction(value, goal) };
}

/** Native drawArc uses whole degrees and equal endpoints mean a complete circle. */
export function progressSweep(fraction) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction >= 1) return 360;
  return Math.max(1, Math.min(359, Math.floor(fraction * 360)));
}

function boxGeometry(bounds, pen, filled = false) {
  const inset = Math.ceil(pen / 2);
  if (filled || bounds.width <= 2 * inset + 1 || bounds.height <= 2 * inset + 1) return { x: 0, y: 0, width: bounds.width, height: bounds.height, filled: true };
  return { x: inset, y: inset, width: bounds.width - 1 - 2 * inset, height: bounds.height - 1 - 2 * inset, filled: false };
}

function boxMarkup(bounds, pen, foreground, filled = false, radius = 0) {
  const box = boxGeometry(bounds, pen, filled);
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${Math.floor(Math.min(radius, box.width / 2, box.height / 2))}" fill="${box.filled ? foreground : 'none'}"${box.filled ? '' : ` stroke="${foreground}" stroke-width="${pen}"`}/>`;
}

function missingMarkup(bounds, foreground) {
  const cy = Math.floor(bounds.height / 2), cx = Math.floor(bounds.width / 2);
  if (bounds.width < 6 || bounds.height < 2) return `<rect x="${cx}" y="${cy}" width="1" height="1" fill="${foreground}"/>`;
  return `<path fill="${foreground}" d="M${cx - 3} ${cy}h2v1h-2zM${cx + 1} ${cy}h2v1h-2z"/>`;
}

function iconMarkup(rows, bounds, foreground) {
  const side = Math.min(bounds.width, bounds.height), x = Math.floor((bounds.width - side) / 2), y = Math.floor((bounds.height - side) / 2);
  const parts = [];
  for (let row = 0; row < ICON_SIZE; row++) for (let column = 0; column < ICON_SIZE; column++) {
    if (!(rows[row] & (1 << (ICON_SIZE - 1 - column)))) continue;
    const left = Math.floor(column * side / ICON_SIZE), top = Math.floor(row * side / ICON_SIZE);
    const width = Math.floor((column + 1) * side / ICON_SIZE) - left, height = Math.floor((row + 1) * side / ICON_SIZE) - top;
    if (width && height) parts.push(`M${x + left} ${y + top}h${width}v${height}h-${width}z`);
  }
  return `<path fill="${foreground}" shape-rendering="crispEdges" d="${parts.join('')}"/>`;
}

/** Return local-coordinate SVG only for graphics; unsupported text types return null. */
export function renderGraphicMarkup(element, samples = {}) {
  if (!['line', 'circle', 'rectangle', 'progressBar', 'progressRing', 'icon'].includes(element.type)) return null;
  const bounds = rectangle(element), foreground = color(element);
  if (element.type === 'line') return `<rect width="${bounds.width}" height="${bounds.height}" fill="${foreground}"/>`;
  if (element.type === 'circle') return `<ellipse cx="${bounds.width / 2}" cy="${bounds.height / 2}" rx="${Math.max(0, bounds.width / 2 - 1)}" ry="${Math.max(0, bounds.height / 2 - 1)}" fill="none" stroke="${foreground}" stroke-width="1"/>`;
  if (element.type === 'icon') return iconMarkup(iconRows(element), bounds, foreground);
  const pen = stroke(element, bounds);
  if (element.type === 'rectangle') {
    if (element.filled !== undefined && typeof element.filled !== 'boolean') throw new TypeError('Invalid graphics fill.');
    return boxMarkup(bounds, pen, foreground, element.filled === true, finite(element.cornerRadius, 0, 'corner radius', 0, 100));
  }
  const fraction = sampleProgress(element, samples).fraction;
  if (element.type === 'progressBar') {
    const frame = boxMarkup(bounds, pen, foreground);
    const inset = pen + 1, width = bounds.width - 2 * inset, height = bounds.height - 2 * inset;
    if (width <= 0 || height <= 0) return frame;
    if (fraction === null) return frame + `<g transform="translate(${inset} ${inset})">${missingMarkup({ width, height }, foreground)}</g>`;
    const filled = fraction > 0 ? Math.max(1, Math.floor(width * fraction)) : 0;
    return frame + (filled ? `<rect x="${inset}" y="${inset}" width="${filled}" height="${height}" fill="${foreground}"/>` : '');
  }
  const cx = Math.floor(bounds.width / 2), cy = Math.floor(bounds.height / 2);
  const radius = Math.floor((Math.min(bounds.width, bounds.height) - 1 - pen) / 2);
  if (radius < 1) return `<rect x="${cx}" y="${cy}" width="1" height="1" fill="${foreground}"/>`;
  const track = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${foreground}" stroke-width="1"/>`;
  if (fraction === null) return track + missingMarkup(bounds, foreground);
  const sweep = progressSweep(fraction);
  if (!sweep) return track;
  if (sweep === 360) return track + `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${foreground}" stroke-width="${pen}"/>`;
  const angle = (-90 + sweep) * Math.PI / 180;
  const endX = Number((cx + radius * Math.cos(angle)).toFixed(5)), endY = Number((cy + radius * Math.sin(angle)).toFixed(5));
  return track + `<path d="M${cx} ${cy - radius}A${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${endX} ${endY}" fill="none" stroke="${foreground}" stroke-width="${pen}"/>`;
}

/** Expressions are trusted exporter-generated reads; they never come from design JSON. */
export function graphicDrawCalls(element, box, { valueExpression = 'null', goalExpression = 'null' } = {}) {
  const bounds = rectangle(box), { x, y, width, height } = bounds;
  if (element.type === 'rectangle') {
    if (element.filled !== undefined && typeof element.filled !== 'boolean') throw new TypeError('Invalid graphics fill.');
    const radius = Math.round(finite(element.cornerRadius, 0, 'corner radius', 0, 100));
    return `        drawGraphicBox(dc, ${x}, ${y}, ${width}, ${height}, ${stroke(element, bounds)}, ${radius}, ${element.filled === true});`;
  }
  if (element.type === 'icon') return `        drawGraphicIcon(dc, ${x}, ${y}, ${width}, ${height}, [${iconRows(element).join(', ')}]);`;
  if (!['progressBar', 'progressRing'].includes(element.type)) return null;
  const key = source(element), configuredGoal = customGoal(element), goal = key === 'battery' ? 0 : configuredGoal;
  const automatic = key === 'battery' ? '100' : goalExpression;
  const fraction = `graphicProgress(${valueExpression}, ${automatic}, ${goal}, ${PROGRESS_DEFAULT_GOALS[key]})`;
  return `        drawProgress${element.type === 'progressBar' ? 'Bar' : 'Ring'}(dc, ${x}, ${y}, ${width}, ${height}, ${stroke(element, bounds)}, ${fraction});`;
}

/** Self-contained helpers for an exported WatchFace class. No extra permissions. */
export function graphicsMethodsSource() {
  return `    function graphicProgress(value, automaticGoal, customGoal, defaultGoal) {
        if (value == null || value != value) { return null; }
        var goal = customGoal > 0 ? customGoal : automaticGoal;
        if (goal == null || goal != goal || goal <= 0) { goal = defaultGoal; }
        var fraction = value * 1.0 / goal;
        if (fraction < 0) { return 0.0; }
        if (fraction > 1) { return 1.0; }
        return fraction;
    }

    function drawGraphicBox(dc, x, y, width, height, pen, radius, filled) {
        var inset = ((pen + 1) / 2).toNumber();
        var limit = ((width < height ? width : height) / 2).toNumber();
        if (radius > limit) { radius = limit; }
        if (filled || width <= 2 * inset + 1 || height <= 2 * inset + 1) {
            if (radius > 0) { dc.fillRoundedRectangle(x, y, width, height, radius); }
            else { dc.fillRectangle(x, y, width, height); }
            return;
        }
        var innerWidth = width - 1 - 2 * inset;
        var innerHeight = height - 1 - 2 * inset;
        limit = ((innerWidth < innerHeight ? innerWidth : innerHeight) / 2).toNumber();
        if (radius > limit) { radius = limit; }
        dc.setPenWidth(pen);
        if (radius > 0) { dc.drawRoundedRectangle(x + inset, y + inset, innerWidth, innerHeight, radius); }
        else { dc.drawRectangle(x + inset, y + inset, innerWidth, innerHeight); }
        dc.setPenWidth(1);
    }

    function drawMissingProgress(dc, x, y, width, height) {
        var cx = x + (width / 2).toNumber();
        var cy = y + (height / 2).toNumber();
        if (width < 6 || height < 2) { dc.fillRectangle(cx, cy, 1, 1); return; }
        dc.fillRectangle(cx - 3, cy, 2, 1);
        dc.fillRectangle(cx + 1, cy, 2, 1);
    }

    function drawProgressBar(dc, x, y, width, height, pen, fraction) {
        drawGraphicBox(dc, x, y, width, height, pen, 0, false);
        var inset = pen + 1;
        var innerWidth = width - 2 * inset;
        var innerHeight = height - 2 * inset;
        if (innerWidth <= 0 || innerHeight <= 0) { return; }
        if (fraction == null) { drawMissingProgress(dc, x + inset, y + inset, innerWidth, innerHeight); return; }
        if (fraction <= 0) { return; }
        var filledWidth = (innerWidth * fraction).toNumber();
        if (filledWidth < 1) { filledWidth = 1; }
        dc.fillRectangle(x + inset, y + inset, filledWidth, innerHeight);
    }

    function drawProgressRing(dc, x, y, width, height, pen, fraction) {
        var cx = x + (width / 2).toNumber();
        var cy = y + (height / 2).toNumber();
        var side = width < height ? width : height;
        var radius = ((side - 1 - pen) / 2).toNumber();
        if (radius < 1) { dc.fillRectangle(cx, cy, 1, 1); return; }
        dc.setPenWidth(1);
        dc.drawCircle(cx, cy, radius);
        if (fraction == null) { drawMissingProgress(dc, x, y, width, height); return; }
        if (fraction <= 0) { return; }
        dc.setPenWidth(pen);
        if (fraction >= 1) { dc.drawCircle(cx, cy, radius); }
        else {
            var sweep = (fraction * 360).toNumber();
            if (sweep < 1) { sweep = 1; }
            if (sweep > 359) { sweep = 359; }
            dc.drawArc(cx, cy, radius, Graphics.ARC_CLOCKWISE, 90, (90 - sweep + 360) % 360);
        }
        dc.setPenWidth(1);
    }

    function drawGraphicIcon(dc, x, y, width, height, rows as Lang.Array) {
        var side = width < height ? width : height;
        var left = x + ((width - side) / 2).toNumber();
        var top = y + ((height - side) / 2).toNumber();
        for (var row = 0; row < ${ICON_SIZE}; row += 1) {
            for (var column = 0; column < ${ICON_SIZE}; column += 1) {
                if ((rows[row] & (1 << (${ICON_SIZE - 1} - column))) == 0) { continue; }
                var px = (column * side / ${ICON_SIZE}).toNumber();
                var py = (row * side / ${ICON_SIZE}).toNumber();
                var pw = ((column + 1) * side / ${ICON_SIZE}).toNumber() - px;
                var ph = ((row + 1) * side / ${ICON_SIZE}).toNumber() - py;
                if (pw > 0 && ph > 0) { dc.fillRectangle(left + px, top + py, pw, ph); }
            }
        }
    }
`;
}
