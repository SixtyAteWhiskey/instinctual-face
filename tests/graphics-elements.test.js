import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, PROGRESS_SOURCES as REGISTERED_SOURCES } from '../web/elements.js';
import {
  ICON_BITMAPS, ICON_IDS, PROGRESS_SOURCES, progressFraction, sampleProgress,
  progressSweep, renderGraphicMarkup, graphicDrawCalls, graphicsMethodsSource,
} from '../web/graphics-elements.js';

const layer = (type, properties = {}) => ({ type, x: 10, y: 20, width: 48, height: 48,
  color: '#eeeeee', fontSize: 12, label: false, source: 'steps', goal: 0, ...properties });

test('fixed graphics choices agree with the trusted registry and cannot accept code or resource paths', () => {
  assert.equal(PROGRESS_SOURCES, REGISTERED_SOURCES);
  assert.equal(ICON_IDS, ICON_NAMES);
  assert.deepEqual(Object.keys(ICON_BITMAPS), ICON_IDS);
  assert.ok(Object.isFrozen(ICON_BITMAPS));
  for (const rows of Object.values(ICON_BITMAPS)) {
    assert.ok(Object.isFrozen(rows));
    assert.equal(rows.length, 12);
    assert.ok(rows.every(row => Number.isInteger(row) && row >= 0 && row < 4096));
  }
  for (const icon of ['__proto__', '../../private/key', '<script>bad()</script>']) {
    assert.throws(() => renderGraphicMarkup(layer('icon', { icon })), /Unsupported icon/);
    assert.throws(() => graphicDrawCalls(layer('icon', { icon }), layer('icon')), /Unsupported icon/);
  }
  assert.throws(() => renderGraphicMarkup(layer('progressRing', { source: 'battery); bad();' })), /Unsupported progress source/);
  assert.throws(() => renderGraphicMarkup(layer('rectangle', { color: '#ffffff" onload="bad()' })), /Invalid graphics color/);
});

test('progress keeps a missing reading distinct from zero and clamps underflow and exceeded goals', () => {
  assert.equal(progressFraction(0, 100), 0);
  assert.equal(progressFraction(-20, 100), 0);
  assert.equal(progressFraction(25, 100), .25);
  assert.equal(progressFraction(150, 100), 1);
  for (const [value, goal] of [[null, 100], [undefined, 100], [NaN, 100], [Infinity, 100], [25, 0], [25, -1], [25, Infinity]]) assert.equal(progressFraction(value, goal), null);
  assert.deepEqual(sampleProgress(layer('progressBar'), { steps: 50, stepGoal: 200 }), { value: 50, goal: 200, fraction: .25 });
  assert.equal(sampleProgress(layer('progressBar'), { steps: null }).fraction, null);
  assert.equal(sampleProgress(layer('progressBar', { goal: 100 }), { steps: 50, stepGoal: 200 }).fraction, .5);
  assert.equal(sampleProgress(layer('progressBar', { source: 'floors' }), { floors: 12, floorsGoal: 20 }).fraction, .6);
  assert.equal(sampleProgress(layer('progressBar', { source: 'battery', goal: 10 }), { battery: 82 }).fraction, .82);
  assert.equal(sampleProgress(layer('progressBar', { source: 'calories' }), { calories: 1000, caloriesGoal: 1 }).fraction, .5);
  assert.equal(sampleProgress(layer('progressBar', { source: 'distance' }), { distance: 5, distanceGoal: 1 }).fraction, .5);
  assert.equal(sampleProgress(layer('progressBar'), { steps: 1000, stepGoal: 0 }).goal, 10000);
});

test('automatic progress goals accept finite numeric preview strings and reject unavailable values', () => {
  const bar = layer('progressBar');
  for (const stepGoal of ['250', ' 250 ', '2.5e2', '2,500']) {
    const goal = stepGoal.includes(',') ? 2500 : 250;
    assert.deepEqual(sampleProgress(bar, { steps: 50, stepGoal }), { value: 50, goal, fraction: 50 / goal });
  }
  assert.equal(sampleProgress(layer('progressRing', { source: 'floors' }), { floors: 12, floorsGoal: '20' }).fraction, .6);
  for (const stepGoal of ['', ' ', '--', 'NaN', 'Infinity', '25%', '2,0', '0xff', '0', '-100', null, Infinity]) {
    assert.equal(sampleProgress(bar, { steps: 50, stepGoal }).goal, 10000);
  }
  assert.equal(sampleProgress(layer('progressBar', { goal: 100 }), { steps: 50, stepGoal: '250' }).goal, 100);
  assert.match(graphicDrawCalls(layer('progressBar', { source: 'calories' }), bar), /graphicProgress\(null, null, 0, 2000\)/);
});

test('rings suppress a zero arc, draw a full ring explicitly, and never use equal partial endpoints', () => {
  for (const fraction of [null, undefined, NaN, -1, 0]) assert.equal(progressSweep(fraction), 0);
  assert.equal(progressSweep(.000001), 1);
  assert.equal(progressSweep(.5), 180);
  assert.equal(progressSweep(.999999), 359);
  assert.equal(progressSweep(1), 360);
  const empty = renderGraphicMarkup(layer('progressRing'), { steps: 0 });
  assert.equal((empty.match(/<circle/g) ?? []).length, 1);
  assert.doesNotMatch(empty, /<path/);
  const complete = renderGraphicMarkup(layer('progressRing'), { steps: 20000 });
  assert.equal((complete.match(/<circle/g) ?? []).length, 2);
  assert.doesNotMatch(complete, /<path/);
  assert.match(renderGraphicMarkup(layer('progressRing'), { steps: 5000 }), /A22 22 0 0 1/);
  assert.match(renderGraphicMarkup(layer('progressRing'), { steps: null }), /h2v1h-2z/);
  const methods = graphicsMethodsSource();
  assert.match(methods, /if \(fraction <= 0\).*return/);
  assert.match(methods, /if \(fraction >= 1\).*drawCircle/);
  assert.match(methods, /if \(sweep < 1\).*sweep = 1/);
  assert.match(methods, /if \(sweep > 359\).*sweep = 359/);
  assert.match(methods, /Graphics\.ARC_CLOCKWISE, 90, \(90 - sweep \+ 360\) % 360/);
});

test('bars preserve an outlined empty state and show unavailable data without a fake filled fraction', () => {
  const bar = layer('progressBar', { width: 96, height: 10, strokeWidth: 1 });
  const empty = renderGraphicMarkup(bar, { steps: 0 });
  assert.equal((empty.match(/<rect/g) ?? []).length, 1);
  assert.match(empty, /fill="none"/);
  const half = renderGraphicMarkup(bar, { steps: 5000 });
  assert.match(half, /<rect x="2" y="2" width="46" height="6" fill="#eeeeee"/);
  const missing = renderGraphicMarkup(bar, { steps: null });
  assert.match(missing, /h2v1h-2z/);
  assert.equal((missing.match(/<rect/g) ?? []).length, 1);
});

test('fixed bitmap icons remain inside even tiny or nonsquare layer bounds', () => {
  for (const icon of ICON_IDS) for (const [width, height] of [[1, 1], [5, 12], [12, 5], [12, 12], [20, 20], [31, 25]]) {
    const markup = renderGraphicMarkup(layer('icon', { icon, width, height }));
    assert.match(markup, /shape-rendering="crispEdges"/);
    assert.doesNotMatch(markup, /href|image|foreignObject|script/);
    for (const match of markup.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
      const [x, y, w, h] = match.slice(1).map(Number);
      assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, `${icon} leaves ${width}×${height}`);
    }
  }
});

test('rounded rectangles and stroke widths stay bounded and restore the native pen', () => {
  assert.match(renderGraphicMarkup(layer('rectangle', { width: 20, height: 10, filled: true, cornerRadius: 100 })), /rx="5" fill="#eeeeee"/);
  assert.match(renderGraphicMarkup(layer('rectangle', { width: 20, height: 10, strokeWidth: 24 })), /width="20" height="10".*fill="#eeeeee"/);
  assert.match(graphicsMethodsSource(), /if \(radius > limit\).*radius = limit/);
  assert.match(graphicsMethodsSource(), /dc\.setPenWidth\(1\)/);
  for (const change of [{ strokeWidth: 0 }, { strokeWidth: 25 }, { cornerRadius: -1 }, { cornerRadius: Infinity }, { filled: 'true' }, { width: Infinity }]) assert.throws(() => renderGraphicMarkup(layer('rectangle', change)), /Invalid graphics/);
});

test('native graphics calls use fixed masks and trusted expressions with bounded numeric fields', () => {
  const ring = layer('progressRing', { source: 'distance', goal: 6.5 });
  assert.equal(graphicDrawCalls(ring, ring, { valueExpression: 'distanceKm', goalExpression: 'null' }), '        drawProgressRing(dc, 10, 20, 48, 48, 3, graphicProgress(distanceKm, null, 6.5, 10));');
  const battery = layer('progressBar', { source: 'battery', goal: 5 });
  assert.match(graphicDrawCalls(battery, battery, { valueExpression: 'stats.battery' }), /graphicProgress\(stats\.battery, 100, 0, 100\)/);
  const icon = layer('icon', { icon: 'heart' });
  assert.ok(graphicDrawCalls(icon, icon).includes(`[${ICON_BITMAPS.heart.join(', ')}]`));
  assert.throws(() => graphicDrawCalls(ring, { ...ring, x: '0); bad();' }), /Invalid graphics x/);
  assert.throws(() => graphicDrawCalls(layer('progressRing', { goal: 1000001 }), ring), /Invalid graphics goal/);
  assert.throws(() => graphicDrawCalls(layer('progressBar', { source: 'battery', goal: Infinity }), battery), /Invalid graphics goal/);
  assert.equal(renderGraphicMarkup(layer('steps')), null);
});
