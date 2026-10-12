/** Marquee bounds and rigid movement shared by pointer and keyboard selection. */
import { analyzeElement, displayGeometry, isElementSafe } from './display-safety.js';

const EPSILON = 0.00001;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = value => Math.round(value * 100) / 100;
const finite = value => typeof value === 'number' && Number.isFinite(value);

function validBounds(element) {
  return element && ['x', 'y', 'width', 'height'].every(key => finite(element[key])) && element.width >= 0 && element.height >= 0;
}

/** Dragging in any direction produces the same canvas rectangle. */
export function selectionRect(start, end) {
  if (![start?.x, start?.y, end?.x, end?.y].every(finite)) throw new TypeError('Selection coordinates must be finite numbers.');
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Touching bounds count, including thin lines; hidden layers do not. */
export function selectionIds(elements, rect) {
  if (!validBounds(rect)) return [];
  return elements.filter(element => element.visible !== false && validBounds(element) &&
    element.x <= rect.x + rect.width + EPSILON && element.x + element.width >= rect.x - EPSILON &&
    element.y <= rect.y + rect.height + EPSILON && element.y + element.height >= rect.y - EPSILON).map(element => element.id);
}

export function selectionBounds(elements) {
  const visible = elements.filter(element => element.visible !== false && validBounds(element));
  if (!visible.length) return null;
  const x = Math.min(...visible.map(element => element.x)), y = Math.min(...visible.map(element => element.y));
  return { x, y, width: Math.max(...visible.map(element => element.x + element.width)) - x,
    height: Math.max(...visible.map(element => element.y + element.height)) - y };
}

function corners(element) {
  return [[element.x, element.y], [element.x + element.width, element.y],
    [element.x + element.width, element.y + element.height], [element.x, element.y + element.height]];
}

/** Exit time from a convex circle, starting inside it. */
function circleExit([x, y], dx, dy, circle, radius) {
  const ox = x - circle.cx, oy = y - circle.cy;
  const a = dx * dx + dy * dy;
  if (a < Number.EPSILON) return 1;
  const b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - radius * radius;
  return clamp((-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a), 0, 1);
}

/** First entry into the open interior of a rectangle; a tangent is allowed. */
function rectangleEntry([x, y], dx, dy, left, top, right, bottom) {
  let enter = 0, exit = 1;
  for (const [position, movement, low, high] of [[x, dx, left, right], [y, dy, top, bottom]]) {
    if (Math.abs(movement) < Number.EPSILON) {
      if (position <= low || position >= high) return 1;
    } else {
      const first = (low - position) / movement, second = (high - position) / movement;
      enter = Math.max(enter, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
  }
  return enter < exit - Number.EPSILON && exit > 0 ? clamp(enter, 0, 1) : 1;
}

/** First entry into a circle; a path merely touching the edge is allowed. */
function circleEntry([x, y], dx, dy, cx, cy, radius) {
  const ox = x - cx, oy = y - cy, a = dx * dx + dy * dy;
  if (a < Number.EPSILON) return 1;
  const b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return 1;
  const enter = (-b - Math.sqrt(discriminant)) / (2 * a), exit = (-b + Math.sqrt(discriminant)) / (2 * a);
  return exit > 0 && enter < 1 ? clamp(enter, 0, 1) : 1;
}

/** Swept rectangle vs circular bezel: the forbidden center area is a rounded rectangle. */
function bezelEntry(element, dx, dy, circle, margin) {
  const hw = element.width / 2, hh = element.height / 2, radius = circle.bezelRadius + margin;
  const center = [element.x + hw, element.y + hh];
  let limit = Math.min(
    rectangleEntry(center, dx, dy, circle.cx - hw - radius, circle.cy - hh, circle.cx + hw + radius, circle.cy + hh),
    rectangleEntry(center, dx, dy, circle.cx - hw, circle.cy - hh - radius, circle.cx + hw, circle.cy + hh + radius));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    limit = Math.min(limit, circleEntry(center, dx, dy, circle.cx + sx * hw, circle.cy + sy * hh, radius));
  }
  return limit;
}

function pathLimit(elements, dx, dy, geometry, regionFor) {
  let limit = 1;
  for (const element of elements) {
    const area = regionFor(element);
    if (area === 'subscreen' && geometry.subscreen) {
      for (const point of corners(element)) limit = Math.min(limit, circleExit(point, dx, dy, geometry.subscreen, geometry.subscreen.safeRadius));
      continue;
    }
    if (geometry.outer.shape === 'round') {
      for (const point of corners(element)) limit = Math.min(limit, circleExit(point, dx, dy, geometry.outer, geometry.outer.safeRadius));
    } else {
      const points = geometry.outer.safePoints;
      for (const [x, y] of corners(element)) for (let index = 0; index < points.length; index++) {
        const [ax, ay] = points[index], [bx, by] = points[(index + 1) % points.length];
        const distance = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const velocity = (bx - ax) * dy - (by - ay) * dx;
        if (velocity < 0) limit = Math.min(limit, clamp(distance / -velocity, 0, 1));
      }
    }
    if (geometry.subscreen) limit = Math.min(limit, bezelEntry(element, dx, dy, geometry.subscreen, geometry.margin));
  }
  return limit;
}

/**
 * Move the supplied selected layers together. Locked/hidden layers stay put.
 * Safety stops at the first edge along the drag rather than teleporting across
 * the opaque bezel, changing display regions, or reshaping individual layers.
 */
export function moveSelection(elements, device, dx, dy, { safetyMargin = true, snap = false, wholePixels = false, regions } = {}) {
  const unchanged = () => ({ elements: [...elements], dx: 0, dy: 0, changed: false });
  if (!finite(dx) || !finite(dy)) return unchanged();
  const movable = elements.filter(element => element.visible !== false && element.locked !== true && validBounds(element));
  if (!movable.length) return unchanged();
  const geometry = displayGeometry(device, { safetyMargin });
  const bounds = selectionBounds(movable);
  if (bounds.width > geometry.width || bounds.height > geometry.height) return unchanged();
  if (snap) { dx = Math.round(dx / 4) * 4; dy = Math.round(dy / 4) * 4; }
  const minimumX = wholePixels ? Math.ceil(-bounds.x) : -bounds.x;
  const minimumY = wholePixels ? Math.ceil(-bounds.y) : -bounds.y;
  const maximumX = wholePixels ? Math.floor(geometry.width - bounds.x - bounds.width) : geometry.width - bounds.x - bounds.width;
  const maximumY = wholePixels ? Math.floor(geometry.height - bounds.y - bounds.height) : geometry.height - bounds.y - bounds.height;
  if (minimumX > maximumX || minimumY > maximumY) return unchanged();
  dx = clamp(wholePixels ? Math.round(dx) : dx, minimumX, maximumX);
  dy = clamp(wholePixels ? Math.round(dy) : dy, minimumY, maximumY);
  if (Math.abs(dx) < Number.EPSILON && Math.abs(dy) < Number.EPSILON) return unchanged();
  if (safetyMargin) {
    const fixedRegions = new Map(movable.map(element => [element.id,
      (regions instanceof Map ? regions.get(element.id) : regions?.[element.id]) ?? analyzeElement(element, device, { safetyMargin }).region]));
    const regionFor = element => fixedRegions.get(element.id);
    // Effective preview layers normally start safe. Invalid legacy rectangles
    // must be fitted explicitly rather than silently splitting a selection.
    if (movable.some(element => !isElementSafe(element, device, { safetyMargin, region: regionFor(element) }))) return unchanged();
    const limit = pathLimit(movable, dx, dy, geometry, regionFor);
    const length = Math.hypot(dx, dy);
    let fraction = limit;
    let safe = false;
    // Whole-pixel preview layers need whole-pixel translations to preserve
    // their inward-rounded dimensions. Saved fractional geometry defaults to
    // hundredths. Retreat together if either rounding crosses a safe edge.
    const quantize = wholePixels ? Math.round : round;
    const retreat = wholePixels ? 1 : 0.02;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidateX = quantize(dx * fraction), candidateY = quantize(dy * fraction);
      if (pathLimit(movable, candidateX, candidateY, geometry, regionFor) >= 1 - 1e-10 &&
          movable.every(element => isElementSafe({ ...element, x: element.x + candidateX, y: element.y + candidateY }, device,
            { safetyMargin, region: regionFor(element) }))) {
        dx = candidateX; dy = candidateY; safe = true; break;
      }
      fraction = Math.max(0, fraction - retreat / Math.max(length, retreat));
    }
    if (!safe) return unchanged();
  } else {
    dx = wholePixels ? Math.round(dx) : round(dx); dy = wholePixels ? Math.round(dy) : round(dy);
  }
  if (!dx && !dy) return unchanged();
  const movableSet = new Set(movable);
  return { elements: elements.map(element => movableSet.has(element) ? { ...element, x: element.x + dx, y: element.y + dy } : element),
    dx, dy, changed: true };
}

/**
 * Align eligible layers to their combined bounds, or distribute the gaps
 * between their edges. Spacing preserves the first and last layer positions
 * in stable left-to-right / top-to-bottom order. Locked, hidden, and malformed
 * layers are excluded from both the reference bounds and the result.
 *
 * An arrangement is transactional: every requested move must fit exactly in
 * its original display region, including the path past the circular bezel.
 * Rejecting the entire arrangement avoids a partially aligned selection.
 */
export function arrangeSelection(elements, device, action, { safetyMargin = true, wholePixels = false, regions } = {}) {
  const unchanged = (reason = null) => ({ elements: [...elements], changed: false, reason });
  const alignment = {
    left: ['x', 'width', 0], centerX: ['x', 'width', 0.5], right: ['x', 'width', 1],
    top: ['y', 'height', 0], centerY: ['y', 'height', 0.5], bottom: ['y', 'height', 1],
  };
  const spacing = action === 'spaceX' || action === 'spaceY';
  if (!spacing && !Object.hasOwn(alignment, action)) return unchanged('Choose a supported alignment or spacing action.');
  const eligible = elements.filter(element => validBounds(element) && element.visible !== false && element.locked !== true);
  if (eligible.length < (spacing ? 3 : 2)) return unchanged(spacing
    ? 'Select at least 3 visible, unlocked elements to space evenly.'
    : 'Select at least 2 visible, unlocked elements to align.');
  const targets = new Map();
  const quantize = wholePixels ? Math.round : round;
  if (spacing) {
    const axis = action === 'spaceX' ? 'x' : 'y', size = axis === 'x' ? 'width' : 'height';
    // Modern Array.sort is stable, so equal leading edges retain layer order.
    const ordered = [...eligible].sort((a, b) => a[axis] - b[axis]);
    const first = ordered[0], last = ordered.at(-1);
    const gap = (last[axis] + last[size] - first[axis] - ordered.reduce((total, element) => total + element[size], 0)) / (ordered.length - 1);
    if (gap < -EPSILON) return unchanged('These elements need more room for even spacing without overlap.');
    let cursor = first[axis] + first[size] + Math.max(0, gap);
    for (const element of ordered.slice(1, -1)) {
      targets.set(element, { ...element, [axis]: quantize(cursor) });
      cursor += element[size] + Math.max(0, gap);
    }
  } else {
    const [axis, size, fraction] = alignment[action], bounds = selectionBounds(eligible);
    let edge = bounds[axis] + bounds[size] * fraction;
    if (fraction === 0.5) {
      // Anchor the largest layer to a realizable coordinate first. Mixing odd
      // and even sizes can put centers half a pixel apart; using this anchored
      // center prevents the combined bounds from drifting on repeated clicks.
      const largest = eligible.reduce((a, b) => b[size] > a[size] ? b : a);
      edge = quantize(edge - largest[size] / 2) + largest[size] / 2;
    }
    for (const element of eligible) targets.set(element, { ...element, [axis]: quantize(edge - element[size] * fraction) });
  }
  const changes = [...targets].filter(([element, target]) => Math.abs(target.x - element.x) > EPSILON || Math.abs(target.y - element.y) > EPSILON);
  if (!changes.length) return unchanged();
  const geometry = displayGeometry(device, { safetyMargin });
  const fixedRegions = new Map(eligible.map(element => [element.id,
    (regions instanceof Map ? regions.get(element.id) : regions?.[element.id]) ?? analyzeElement(element, device, { safetyMargin }).region]));
  for (const element of eligible) {
    const target = targets.get(element) ?? element;
    if (target.x < -EPSILON || target.y < -EPSILON || target.x + target.width > geometry.width + EPSILON || target.y + target.height > geometry.height + EPSILON) {
      return unchanged('That arrangement would leave the watch display.');
    }
    if (safetyMargin && !isElementSafe(target, device, { safetyMargin, region: fixedRegions.get(element.id) })) {
      return unchanged('That arrangement would cross a display edge or the circular-window bezel.');
    }
  }
  for (const [element, target] of changes) {
    const dx = target.x - element.x, dy = target.y - element.y;
    // Quantize target coordinates, rather than the translations: a fractional
    // saved position can still be aligned to an exact whole-pixel coordinate.
    const moved = moveSelection([element], device, dx, dy, { safetyMargin, snap: false, regions: fixedRegions });
    if (Math.abs(moved.dx - dx) > EPSILON || Math.abs(moved.dy - dy) > EPSILON) {
      return unchanged(safetyMargin
        ? 'That arrangement would cross a display edge or the circular-window bezel.'
        : 'That arrangement cannot be placed exactly within the watch display.');
    }
  }
  const changed = new Map(changes);
  return { elements: elements.map(element => changed.get(element) ?? element), changed: true, reason: null };
}
