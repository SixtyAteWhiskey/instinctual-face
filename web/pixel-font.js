/** Original bitmap glyphs shared by the designer and generated watch source. */
import { ELEMENT_DEFINITIONS } from './elements.js';
import { unitCaption } from './units.js';

export const TINY_GLYPHS = Object.freeze({
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5], N: [5, 7, 7, 7, 5], O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 3, 1], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], ' ': [0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 2], '?': [6, 1, 2, 0, 2],
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [6, 1, 2, 4, 7],
  '3': [6, 1, 2, 1, 6], '4': [5, 5, 7, 1, 1], '5': [7, 4, 6, 1, 6],
  '6': [3, 4, 6, 5, 2], '7': [7, 1, 2, 2, 2], '8': [2, 5, 2, 5, 2],
  '9': [2, 5, 3, 1, 6], '%': [5, 1, 2, 4, 5], ':': [0, 2, 0, 2, 0],
  ',': [0, 0, 0, 2, 4], '-': [0, 0, 7, 0, 0], '/': [1, 1, 2, 4, 4],
  '+': [0, 2, 7, 2, 0], '!': [2, 2, 2, 0, 2], '_': [0, 0, 0, 0, 7],
  '(': [1, 2, 2, 2, 1], ')': [4, 2, 2, 2, 4], "'": [2, 2, 4, 0, 0],
  '"': [5, 5, 0, 0, 0], '=': [0, 7, 0, 7, 0],
});

export const PRIMARY_GLYPHS = Object.freeze({
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 16, 30, 1, 1, 30],
  '6': [14, 16, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  ' ': [0, 0, 0, 0, 0, 0, 0], ':': [0, 4, 4, 0, 4, 4, 0],
  '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 0, 4, 8],
  '-': [0, 0, 0, 31, 0, 0, 0], '/': [1, 2, 2, 4, 8, 8, 16],
  '%': [25, 25, 2, 4, 8, 19, 19], '+': [0, 4, 4, 31, 4, 4, 0],
  '?': [14, 17, 1, 2, 4, 0, 4], '!': [4, 4, 4, 4, 4, 0, 4],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  "'": [4, 4, 8, 0, 0, 0, 0], '"': [10, 10, 0, 0, 0, 0, 0],
  '=': [0, 0, 31, 0, 31, 0, 0], '_': [0, 0, 0, 0, 0, 0, 31],
});

/** Fit a bounded, legible pixel string to BOTH dimensions. X may condense first. */
export function fitPixelText(value, fontSize, width, height, { tiny = false } = {}) {
  const glyphs = tiny ? TINY_GLYPHS : PRIMARY_GLYPHS;
  const columns = tiny ? 3 : 5;
  const rows = tiny ? 5 : 7;
  const normalized = [...String(value ?? '').slice(0, 120).toUpperCase()];
  let replaced = false;
  let characters = normalized.map(character => {
    if (Object.hasOwn(glyphs, character)) return character;
    replaced = true;
    return '?';
  });
  const budgetWidth = Math.max(0, Math.floor(width));
  const budgetHeight = Math.max(0, Math.floor(height));
  const capacity = Math.max(0, Math.floor((budgetWidth + 1) / (columns + 1)));
  let truncated = characters.length > capacity;
  if (truncated) characters = capacity > 3 ? [...characters.slice(0, capacity - 3), '.', '.', '.'] : Array(capacity).fill('.');
  const text = characters.join('');
  const unitWidth = text.length ? text.length * (columns + 1) - 1 : 0;
  // Export rounds requested sizes to device pixels before runtime font fitting.
  const scaleY = Math.max(0, Math.floor(Math.min(Math.max(rows, Math.round(fontSize)), budgetHeight) / rows));
  const scaleX = unitWidth ? Math.min(scaleY, Math.floor(budgetWidth / unitWidth)) : 0;
  if (scaleX < 1 || scaleY < 1) return { text: '', scaleX: 0, scaleY: 0, width: 0, height: 0, truncated: !!value, replaced, tiny };
  return { text, scaleX, scaleY, width: unitWidth * scaleX, height: rows * scaleY, truncated, replaced, tiny };
}

/** Original SVG cells: no browser font or vendor font resources are involved. */
export function pixelTextMarkup(fit, { x = 0, y = 0, boxWidth = fit.width, align = 'center', color = '#eeeeee' } = {}) {
  if (!fit.text || !fit.scaleX || !fit.scaleY) return '';
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Pixel text color must be hexadecimal.');
  const glyphs = fit.tiny ? TINY_GLYPHS : PRIMARY_GLYPHS;
  const columns = fit.tiny ? 3 : 5;
  const offset = align === 'right' ? boxWidth - fit.width : align === 'left' ? 0 : Math.floor((boxWidth - fit.width) / 2);
  const left = Math.floor(x + offset);
  const top = Math.floor(y);
  const paths = [];
  for (let index = 0; index < fit.text.length; index++) {
    const rows = glyphs[fit.text[index]];
    for (let row = 0; row < rows.length; row++) for (let column = 0; column < columns; column++) {
      if (!(rows[row] & (1 << (columns - column - 1)))) continue;
      const px = left + (index * (columns + 1) + column) * fit.scaleX;
      const py = top + row * fit.scaleY;
      paths.push(`M${px} ${py}h${fit.scaleX}v${fit.scaleY}h-${fit.scaleX}Z`);
    }
  }
  return `<path fill="${color}" shape-rendering="crispEdges" d="${paths.join('')}"/>`;
}

/** Caption overrides are independent of the primary value's style. */
export function captionStyle(element, device, units) {
  const scale = Math.max(1, Math.round(device.height / 176));
  const text = element.label === true
    ? Object.hasOwn(element, 'labelText') ? String(element.labelText).slice(0, 32) : unitCaption(element.type, units) ?? ELEMENT_DEFINITIONS[element.type]?.label ?? ''
    : '';
  return { text, fontSize: element.labelFontSize ?? 5 * scale, color: element.labelColor ?? element.color,
    align: element.labelAlign ?? element.align ?? 'center', gap: element.labelGap ?? 3 * scale, padding: scale };
}

/** Caption pixels and budget used unchanged by browser and generated runtime. */
export function fitCaption(label, element, device, units) {
  const style = captionStyle(element, device, units);
  // An explicitly empty override hides a caption even if an old caller supplies one.
  const text = style.text && label !== undefined ? String(label) : style.text;
  const height = Math.max(0, element.height - 7 - style.gap - style.padding);
  if (!text || height < 5) return { fit: null, style: { ...style, text }, budget: 0 };
  const fit = fitPixelText(text, style.fontSize, element.width, height, { tiny: true });
  return { fit: fit.height ? fit : null, style: { ...style, text }, budget: fit.height ? fit.height + style.gap + style.padding : 0 };
}

/** Exact primary/caption placement, shared with Monkey C drawLabel. */
export function layoutPixelElement(primary, label, element, device, units) {
  const labelScale = Math.max(1, Math.round(device.height / 176));
  const caption = fitCaption(label, element, device, units);
  const primaryFit = fitPixelText(primary, element.fontSize, element.width, element.height - caption.budget);
  const labelFit = caption.fit ?? fitPixelText('', 0, 0, 0, { tiny: true });
  const clusterHeight = primaryFit.height + caption.budget;
  const primaryY = Math.max(0, Math.floor((element.height - clusterHeight) / 2));
  return { primaryFit, labelFit, primaryY, labelY: primaryY + primaryFit.height + caption.style.gap,
    clusterHeight, labelScale, captionStyle: caption.style, captionBudget: caption.budget, captionTruncated: labelFit.truncated };
}
