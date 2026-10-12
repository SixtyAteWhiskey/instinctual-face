/** Physical display masks and conservative, opt-out layer placement. */
import { DEVICES } from './devices.js';
import { isGraphicElement } from './elements.js';

const round = value => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const epsilon = 0.00001;

function profile(device) {
  const result = typeof device === 'string' ? DEVICES[device] : device;
  if (!result || !Number.isFinite(result.width) || !Number.isFinite(result.height)) throw new Error('Choose a supported watch display.');
  return result;
}

function octagon(width, height, cut, inset = 0) {
  const diagonal = cut + Math.SQRT2 * inset;
  return [
    [diagonal - inset, inset], [width - diagonal + inset, inset],
    [width - inset, diagonal - inset], [width - inset, height - diagonal + inset],
    [width - diagonal + inset, height - inset], [diagonal - inset, height - inset],
    [inset, height - diagonal + inset], [inset, diagonal - inset],
  ];
}

/** The secondary circle is a separate display, surrounded by an opaque bezel. */
export function displayGeometry(device, { safetyMargin = true } = {}) {
  const bounds = profile(device);
  const margin = safetyMargin ? Math.max(3, round(Math.min(bounds.width, bounds.height) * 3 / 176)) : 0;
  const outer = bounds.shape === 'round'
    ? { shape: 'round', cx: bounds.width / 2, cy: bounds.height / 2, radius: Math.min(bounds.width, bounds.height) / 2,
      safeRadius: Math.max(1, Math.min(bounds.width, bounds.height) / 2 - margin) }
    : { shape: 'polygon', points: octagon(bounds.width, bounds.height, (bounds.displayCornerCut ?? 0.24) * Math.min(bounds.width, bounds.height)),
      safePoints: octagon(bounds.width, bounds.height, (bounds.displayCornerCut ?? 0.24) * Math.min(bounds.width, bounds.height), margin) };
  let subscreen = null;
  if (bounds.hasSubscreen) {
    // Profiles without downloaded geometry use the same conservative proportions
    // as the Instinct family; exact known SDK coordinates always take precedence.
    const area = bounds.subscreen ?? { x: bounds.width * 0.642, y: 0, width: bounds.width * 0.352, height: bounds.height * 0.352 };
    const radius = Math.min(area.width, area.height) / 2;
    subscreen = { ...area, cx: area.x + area.width / 2, cy: area.y + area.height / 2, radius,
      safeRadius: Math.max(1, radius - margin), bezelRadius: radius + (bounds.subscreenBezel ?? 13 * Math.min(bounds.width, bounds.height) / 176),
      approximate: !bounds.subscreen };
  }
  return { width: bounds.width, height: bounds.height, margin, outer, mainPolygon: outer.safePoints ?? null, subscreen };
}

function corners(element) {
  return [[element.x, element.y], [element.x + element.width, element.y],
    [element.x + element.width, element.y + element.height], [element.x, element.y + element.height]];
}

function pointInPolygon([x, y], points) {
  return points.every(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -epsilon;
  });
}

function rectOutsideCircle(element, circle, radius) {
  const x = clamp(circle.cx, element.x, element.x + element.width);
  const y = clamp(circle.cy, element.y, element.y + element.height);
  return Math.hypot(x - circle.cx, y - circle.cy) >= radius - epsilon;
}

function resolveRegion(element, geometry, region = 'auto') {
  if (region === 'subscreen' && geometry.subscreen) return 'subscreen';
  if (region === 'main') return 'main';
  const sub = geometry.subscreen;
  return sub && Math.hypot(element.x + element.width / 2 - sub.cx, element.y + element.height / 2 - sub.cy) <= sub.radius + epsilon
    ? 'subscreen' : 'main';
}

/** Checks every rectangle corner, plus the main screen's opaque circular bezel. */
export function isElementSafe(element, device, { safetyMargin = true, region = 'auto' } = {}) {
  const geometry = displayGeometry(device, { safetyMargin });
  if (!safetyMargin) return element.x >= 0 && element.y >= 0 && element.x + element.width <= geometry.width && element.y + element.height <= geometry.height;
  const area = resolveRegion(element, geometry, region);
  if (area === 'subscreen') return corners(element).every(([x, y]) => Math.hypot(x - geometry.subscreen.cx, y - geometry.subscreen.cy) <= geometry.subscreen.safeRadius + epsilon);
  const outerFits = geometry.outer.shape === 'round'
    ? corners(element).every(([x, y]) => Math.hypot(x - geometry.outer.cx, y - geometry.outer.cy) <= geometry.outer.safeRadius + epsilon)
    : corners(element).every(point => pointInPolygon(point, geometry.outer.safePoints));
  return outerFits && (!geometry.subscreen || rectOutsideCircle(element, geometry.subscreen, geometry.subscreen.bezelRadius + geometry.margin));
}

function nearestOnSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return [a[0] + dx * t, a[1] + dy * t];
}

function clipPolygon(points, a, b, c) {
  const result = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    const currentDistance = a * current[0] + b * current[1] - c;
    const nextDistance = a * next[0] + b * next[1] - c;
    if (currentDistance >= -epsilon) result.push(current);
    if ((currentDistance >= 0) !== (nextDistance >= 0)) {
      const t = currentDistance / (currentDistance - nextDistance);
      result.push([current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t]);
    }
  }
  return result;
}

function centerPolygon(geometry, width, height) {
  let result = [[0, 0], [geometry.width, 0], [geometry.width, geometry.height], [0, geometry.height]];
  const points = geometry.outer.safePoints;
  for (let index = 0; index < points.length && result.length; index++) {
    const [ax, ay] = points[index], [bx, by] = points[(index + 1) % points.length];
    const a = -(by - ay), b = bx - ax;
    result = clipPolygon(result, a, b, a * ax + b * ay + Math.abs(a) * width / 2 + Math.abs(b) * height / 2);
  }
  return result;
}

function circleIntersections(a, b, center, radius) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ox = a[0] - center[0], oy = a[1] - center[1];
  const coefficient = dx * dx + dy * dy;
  if (coefficient < epsilon) return [];
  const linear = 2 * (ox * dx + oy * dy), constant = ox * ox + oy * oy - radius * radius;
  const discriminant = linear * linear - 4 * coefficient * constant;
  if (discriminant < 0) return [];
  return [(-linear + Math.sqrt(discriminant)) / (2 * coefficient), (-linear - Math.sqrt(discriminant)) / (2 * coefficient)]
    .filter(t => t >= 0 && t <= 1).map(t => [a[0] + dx * t, a[1] + dy * t]);
}

function mainCenter(geometry, width, height, desired) {
  const polygon = centerPolygon(geometry, width, height);
  if (!polygon.length) return null;
  const candidates = [...polygon, desired];
  for (let index = 0; index < polygon.length; index++) candidates.push(nearestOnSegment(desired, polygon[index], polygon[(index + 1) % polygon.length]));
  const sub = geometry.subscreen;
  if (sub) {
    const radius = sub.bezelRadius + geometry.margin + 0.015;
    const hw = width / 2, hh = height / 2;
    // Configuration-space boundary of a rectangle around the circular bezel.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const center = [sub.cx + sx * hw, sub.cy + sy * hh];
      const dx = desired[0] - center[0], dy = desired[1] - center[1];
      const magnitude = Math.hypot(dx, dy) || 1;
      if (dx * sx >= 0 && dy * sy >= 0) candidates.push([center[0] + radius * dx / magnitude, center[1] + radius * dy / magnitude]);
      candidates.push([center[0] + sx * radius, center[1]], [center[0], center[1] + sy * radius]);
      for (let index = 0; index < polygon.length; index++) {
        for (const point of circleIntersections(polygon[index], polygon[(index + 1) % polygon.length], center, radius)) {
          if ((point[0] - center[0]) * sx >= -epsilon && (point[1] - center[1]) * sy >= -epsilon) candidates.push(point);
        }
      }
    }
    candidates.push([sub.cx - hw - radius, clamp(desired[1], sub.cy - hh, sub.cy + hh)],
      [sub.cx + hw + radius, clamp(desired[1], sub.cy - hh, sub.cy + hh)],
      [clamp(desired[0], sub.cx - hw, sub.cx + hw), sub.cy - hh - radius],
      [clamp(desired[0], sub.cx - hw, sub.cx + hw), sub.cy + hh + radius]);
  }
  const valid = candidates.filter(point => pointInPolygon(point, polygon) && (!sub || rectOutsideCircle({ x: point[0] - width / 2, y: point[1] - height / 2, width, height }, sub, sub.bezelRadius + geometry.margin)));
  valid.sort((a, b) => Math.hypot(a[0] - desired[0], a[1] - desired[1]) - Math.hypot(b[0] - desired[0], b[1] - desired[1]));
  return valid[0] ?? null;
}

function circleFit(element, circle) {
  const desired = [element.x + element.width / 2, element.y + element.height / 2];
  const radius = circle.safeRadius - 0.03;
  const scale = Math.min(1, radius / Math.hypot(element.width / 2, element.height / 2));
  let width = Math.max(1, round(element.width * scale)), height = Math.max(1, round(element.height * scale));
  if (circle.bezelRadius && !isGraphicElement(element.type)) {
    // Caption clusters need their vertical rows more than spare horizontal
    // space. Preserve that height first; runtime text can condense its glyphs.
    const minimumWidth = Math.min(element.width, 5);
    height = Math.min(element.height, 2 * Math.sqrt(Math.max(0, radius * radius - minimumWidth * minimumWidth / 4)));
    width = Math.min(element.width, 2 * Math.sqrt(Math.max(0, radius * radius - height * height / 4)));
    // Inward sizes leave enough room to round the final center to 0.01 pixels.
    width = Math.max(1, Math.floor(width * 100) / 100);
    height = Math.max(1, Math.floor(height * 100) / 100);
  }
  let [x, y] = desired;
  for (let iteration = 0; iteration < 160; iteration++) {
    let adjusted = false;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const dx = x + sx * width / 2 - circle.cx, dy = y + sy * height / 2 - circle.cy;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) { x -= dx * (1 - radius / distance); y -= dy * (1 - radius / distance); adjusted = true; }
    }
    if (!adjusted) break;
  }
  const result = { ...element, width, height, x: round(x - width / 2), y: round(y - height / 2) };
  if (corners(result).some(([px, py]) => Math.hypot(px - circle.cx, py - circle.cy) > circle.safeRadius)) {
    result.x = round(circle.cx - width / 2); result.y = round(circle.cy - height / 2);
  }
  return result;
}

/** Fits a copy into visible pixels. Raw saved designs are never rewritten here. */
export function constrainElement(element, device, { safetyMargin = true, region = 'auto', snap = false } = {}) {
  const geometry = displayGeometry(device, { safetyMargin });
  const proposed = { ...element };
  if (snap) { proposed.x = Math.round(proposed.x / 4) * 4; proposed.y = Math.round(proposed.y / 4) * 4; }
  if (!safetyMargin) return { ...proposed, x: round(clamp(proposed.x, 0, Math.max(0, geometry.width - proposed.width))), y: round(clamp(proposed.y, 0, Math.max(0, geometry.height - proposed.height))) };
  const area = resolveRegion(proposed, geometry, region);
  if (isElementSafe(proposed, device, { safetyMargin, region: area })) return proposed;
  if (area === 'subscreen') return circleFit(proposed, geometry.subscreen);
  if (geometry.outer.shape === 'round') return circleFit(proposed, geometry.outer);
  const desired = [proposed.x + proposed.width / 2, proposed.y + proposed.height / 2];
  let width = proposed.width, height = proposed.height;
  let center = mainCenter(geometry, width, height, desired);
  if (!center) {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (low + high) / 2;
      if (mainCenter(geometry, Math.max(1, width * middle), Math.max(1, height * middle), desired)) low = middle; else high = middle;
    }
    width = Math.max(1, round(width * Math.max(0, low - 0.0002)));
    height = Math.max(1, round(height * Math.max(0, low - 0.0002)));
    center = mainCenter(geometry, width, height, desired) ?? [geometry.width / 2, geometry.height / 2];
  }
  let result = { ...proposed, width, height, x: round(center[0] - width / 2), y: round(center[1] - height / 2) };
  // Rounding must not move a rectangle back over an edge. A tiny inset retains
  // precision for source export while leaving the requested visual size intact.
  if (!isElementSafe(result, device, { safetyMargin, region: 'main' })) {
    const safer = displayGeometry(device, { safetyMargin });
    safer.margin += 0.025;
    safer.outer.safePoints = octagon(geometry.width, geometry.height, (profile(device).displayCornerCut ?? 0.24) * Math.min(geometry.width, geometry.height), safer.margin);
    let safeCenter = mainCenter(safer, width, height, desired);
    if (!safeCenter) {
      width = round(Math.max(1, width - 0.08)); height = round(Math.max(1, height - 0.08));
      safeCenter = mainCenter(safer, width, height, desired);
    }
    if (safeCenter) result = { ...proposed, width, height, x: round(safeCenter[0] - width / 2), y: round(safeCenter[1] - height / 2) };
  }
  return result;
}

/** Both SVG and Monkey C use this inward rectangle, on the same device pixels. */
export function pixelRectangle(element) {
  const x = Math.ceil(element.x), y = Math.ceil(element.y);
  return { ...element, x, y, width: Math.max(1, Math.floor(element.x + element.width) - x),
    height: Math.max(1, Math.floor(element.y + element.height) - y) };
}

/** Explains the effective display region and any geometry adjustment to the UI. */
export function analyzeElement(element, device, options = {}) {
  const geometry = displayGeometry(device, options);
  const region = resolveRegion(element, geometry, options.region);
  const adjusted = constrainElement(element, device, { ...options, region });
  const safe = isElementSafe(element, device, { ...options, region });
  return { region, safe, adjusted, changed: ['x', 'y', 'width', 'height'].some(key => Math.abs(element[key] - adjusted[key]) > 0.01),
    reason: safe ? '' : region === 'subscreen' ? 'This layer crosses the circular window’s safe edge.' : 'This layer crosses the display edge or the circular window’s bezel.' };
}
