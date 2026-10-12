import { DEVICES } from './devices.js';
import { elementSample } from './model.js';
import { displayGeometry, analyzeElement, constrainElement, pixelRectangle } from './display-safety.js';
import { fitCaption, layoutPixelElement, pixelTextMarkup } from './pixel-font.js';

import { isGraphicElement } from './elements.js';
import { renderGraphicMarkup } from './graphics-elements.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points = polygon => polygon.map(point => point.join(',')).join(' ');
const circle = (cx, cy, radius, attributes = '') => `<circle cx="${cx}" cy="${cy}" r="${radius}" ${attributes}/>`;
const outline = (outer, safe = false, attributes = '') => outer.shape === 'round'
  ? circle(outer.cx, outer.cy, safe ? outer.safeRadius : outer.radius, attributes)
  : `<polygon points="${points(safe ? outer.safePoints : outer.points)}" ${attributes}/>`;

export function effectiveElement(element, device, safetyMargin = true) {
  return safetyMargin ? pixelRectangle(constrainElement(element, device, { safetyMargin })) : { ...element };
}

// Main-display stock fonts differ by watch. Circle lettering is exact shared pixels.
export function fitPreviewText(value, element, device, measure, units) {
  const captionLayout = fitCaption(value.label, element, device, units);
  const available = element.height - captionLayout.budget;
  const floor = device.minNativeFontHeight ?? (device.display === 'mip' ? 21 : 24);
  const candidates = [floor, floor + 1, floor + 4, floor + 8, floor + 12, floor + 18, floor + 21, floor + 33]
    .map(height => device.display === 'amoled' ? height * device.height / 176 : height);
  const textWidth = height => measure(value.primary, height, element) * (device.display === 'mip' ? .72 : 1);
  const valid = candidates.filter(height => height <= available && textWidth(height) <= element.width);
  if (!valid.length) return { pixel: layoutPixelElement(value.primary, value.label, element, device, units) };
  const height = valid.reduce((best, candidate) => Math.abs(candidate - element.fontSize) < Math.abs(best - element.fontSize) ? candidate : best);
  const caption = captionLayout.fit;
  const top = Math.max(0, Math.floor((element.height - height - captionLayout.budget) / 2));
  return { height, width: textWidth(height), top, caption, captionStyle: captionLayout.style, labelY: top + height + captionLayout.style.gap };
}

function bitmapContent(layout, element) {
  return pixelTextMarkup(layout.primaryFit, { y: layout.primaryY, boxWidth: element.width, align: element.align, color: element.color })
    + pixelTextMarkup(layout.labelFit, { y: layout.labelY, boxWidth: element.width, align: layout.captionStyle.align, color: layout.captionStyle.color });
}

function marqueeMarkup(box, width, height) {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return '';
  const x1 = Math.max(0, Math.min(width, Math.min(box.x, box.x + box.width)));
  const y1 = Math.max(0, Math.min(height, Math.min(box.y, box.y + box.height)));
  const x2 = Math.max(0, Math.min(width, Math.max(box.x, box.x + box.width)));
  const y2 = Math.max(0, Math.min(height, Math.max(box.y, box.y + box.height)));
  if (x2 <= x1 || y2 <= y1) return '';
  return `<rect class="selection-marquee" x="${x1}" y="${y1}" width="${x2-x1}" height="${y2-y1}" fill="#b9d578" fill-opacity=".15" stroke="#b9d578" stroke-width=".8" stroke-dasharray="3 2" pointer-events="none"/>`;
}

export function renderFaceMarkup(face, { editor = true, preview = false, selectedId = null, selectedIds = null, selectionBox = null, samples = {}, measure = (text, height) => text.length * height * .48 } = {}) {
  const device = DEVICES[face.device];
  const safetyMargin = face.settings.safetyMargin !== false;
  const geometry = displayGeometry(device, { safetyMargin });
  const { width, height, outer, subscreen } = geometry;
  const suffix = `${String(face.id).replace(/[^a-z0-9_-]/gi, '')}-${editor ? 'editor' : 'image'}`;
  const maskId = `display-mask-${suffix}`, gridId = `pixel-grid-${suffix}`;
  const definition = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:luminance"><rect width="${width}" height="${height}" fill="black"/>${outline(outer, false, 'fill="white"')}${subscreen ? circle(subscreen.cx, subscreen.cy, subscreen.bezelRadius, 'fill="black"') + circle(subscreen.cx, subscreen.cy, subscreen.radius, 'fill="white"') : ''}</mask>`;
  const rendered = [], overlays = [];
  const selected = new Set(selectedIds === null ? selectedId ? [selectedId] : [] : selectedIds instanceof Set || Array.isArray(selectedIds) ? selectedIds : []);
  const elements = face.elements.filter(element => element.visible).map(raw => effectiveElement(raw, device, safetyMargin));
  const selectedElements = elements.filter(element => selected.has(element.id));
  for (const element of elements) {
    const value = elementSample(element, samples, face.settings.units);
    let content;
    if (isGraphicElement(element.type)) content = renderGraphicMarkup(element, samples);
    else if (safetyMargin && analyzeElement(element, device).region === 'subscreen') content = bitmapContent(layoutPixelElement(value.primary, value.label, element, device, face.settings.units), element);
    else {
      const layout = fitPreviewText(value, element, device, measure, face.settings.units);
      const tx = element.align === 'left' ? 0 : element.align === 'center' ? Math.floor(element.width/2) : element.width;
      content = layout.pixel ? bitmapContent(layout.pixel, element)
        : `<text x="${tx}" y="${layout.top}" dominant-baseline="text-before-edge" fill="${element.color}" font-size="${layout.height}" textLength="${Math.min(element.width,layout.width)}" lengthAdjust="spacingAndGlyphs" text-anchor="${{left:'start',center:'middle',right:'end'}[element.align]}" font-family="'Arial Narrow','Liberation Sans Narrow',Arial,sans-serif" font-weight="${element.type === 'time' ? 700 : 600}">${escape(value.primary)}</text>${layout.caption ? pixelTextMarkup(layout.caption, { y: layout.labelY, boxWidth: element.width, align: layout.captionStyle.align, color: layout.captionStyle.color }) : ''}`;
    }
    rendered.push(`<g transform="translate(${element.x} ${element.y})"><svg width="${element.width}" height="${element.height}" overflow="hidden">${content}</svg></g>`);
    if (editor && !preview) {
      const isSelected = selected.has(element.id);
      overlays.push(`<g transform="translate(${element.x} ${element.y})" data-element="${escape(element.id)}" class="face-element${isSelected ? ' selected' : ''}${element.locked ? ' locked' : ''}"><rect width="${element.width}" height="${element.height}" fill="transparent"/>${isSelected ? `<rect class="selection-outline" x="-1" y="-1" width="${element.width+2}" height="${element.height+2}" fill="none" stroke="${element.locked ? '#93a47d' : '#b9d578'}" stroke-width=".7" stroke-dasharray="2 2" pointer-events="none"/>${element.locked || selected.size !== 1 ? '' : `<rect data-resize="true" x="${element.width-3}" y="${element.height-3}" width="6" height="6" fill="#b9d578" stroke="#172013" stroke-width="1" class="resize-handle"/>`}` : ''}</g>`);
    }
  }
  if (editor && !preview) {
    if (selectedElements.length > 1) {
      const x = Math.min(...selectedElements.map(element => element.x));
      const y = Math.min(...selectedElements.map(element => element.y));
      const right = Math.max(...selectedElements.map(element => element.x + element.width));
      const bottom = Math.max(...selectedElements.map(element => element.y + element.height));
      overlays.push(`<rect class="selection-group" x="${x-1}" y="${y-1}" width="${right-x+2}" height="${bottom-y+2}" fill="none" stroke="#b9d578" stroke-width=".8" stroke-dasharray="4 2" pointer-events="none"/>`);
    }
    overlays.push(marqueeMarkup(selectionBox, width, height));
  }
  const guide = editor && !preview && safetyMargin ? `<g class="safety-guide" fill="none" stroke="#b9d578" stroke-width=".6" stroke-dasharray="2 2" opacity=".65" pointer-events="none">${outline(outer, true)}${subscreen ? circle(subscreen.cx, subscreen.cy, subscreen.bezelRadius+geometry.margin) + circle(subscreen.cx, subscreen.cy, subscreen.safeRadius) : ''}</g>` : '';
  return `<defs>${definition}<pattern id="${gridId}" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M4 0L0 0 0 4" fill="none" stroke="${face.background === '#111111' ? '#4a5445' : '#a1ac93'}" stroke-width=".25"/></pattern></defs><g mask="url(#${maskId})"><rect width="${width}" height="${height}" fill="${face.background}"/>${editor && face.settings.grid && !preview ? `<rect width="${width}" height="${height}" fill="url(#${gridId})"/>` : ''}${rendered.join('')}${guide}</g>${overlays.join('')}`;
}
