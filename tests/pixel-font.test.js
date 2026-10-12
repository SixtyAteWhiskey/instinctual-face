import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICES } from '../web/devices.js';
import { captionStyle, fitCaption, layoutPixelElement, pixelTextMarkup, fitPixelText } from '../web/pixel-font.js';
const solar = DEVICES.instinct3solar50mm;
const metric = { type: 'steps', label: true, color: '#eeeeee', align: 'center', fontSize: 23, width: 44, height: 32 };

test('legacy captions retain default text, primary color/alignment and nine pixel budget', () => {
  assert.deepEqual(captionStyle(metric, solar), { text: 'STEPS', fontSize: 5, color: '#eeeeee', align: 'center', gap: 3, padding: 1 });
  const layout = layoutPixelElement('100,000', undefined, metric, solar);
  assert.deepEqual([layout.primaryFit.text, layout.primaryFit.width, layout.primaryFit.height, layout.captionBudget], ['100,000', 41, 21, 9]);
  assert.deepEqual([layout.primaryY, layout.labelY, layout.labelFit.height], [1,25,5]);
});

test('caption text, size, alignment, color and gap are independent of the value', () => {
  const changed = { ...metric, labelText: 'POWER 82%', labelFontSize: 10, labelGap: 1, labelAlign: 'right', labelColor: '#111111' };
  const style = captionStyle(changed, solar);
  assert.deepEqual(style, { text: 'POWER 82%', fontSize: 10, color: '#111111', align: 'right', gap: 1, padding: 1 });
  assert.equal(changed.fontSize, 23);
  const layout = layoutPixelElement('100,000', undefined, changed, solar);
  assert.equal(layout.labelFit.height, 10);
  assert.equal(layout.captionBudget, 12);
  assert.equal(layout.primaryFit.text, '100,000');
  assert.ok(layout.labelY + layout.labelFit.height <= changed.height);
  assert.match(pixelTextMarkup(layout.labelFit, { boxWidth: changed.width, color: style.color, align: style.align }), /fill="#111111"/);
});

test('empty captions and short boxes return all available height to the primary value', () => {
  for (const changed of [{ ...metric, labelText: '' }, { ...metric, label: false }, { ...metric, height: 12 }]) {
    const fitted = fitCaption('STEPS', changed, solar);
    assert.equal(fitted.fit, null);assert.equal(fitted.budget, 0);
  }
  assert.equal(layoutPixelElement('100,000', 'STEPS', { ...metric, labelText: '' }, solar).primaryFit.height, 21);
});

test('large or long captions fit actual available width and height and reserve readable primary rows', () => {
  for (const height of [16, 32, 60]) for (const fontSize of [5, 10, 100]) {
    const changed = { ...metric, height, labelText: 'LONG CAPTION 123 / 45%', labelFontSize: fontSize, labelGap: 2 };
    const caption = fitCaption(undefined, changed, solar);
    assert.ok(caption.fit.width <= changed.width);
    assert.ok(caption.fit.height + 7 + 2 + 1 <= height);
    assert.equal(caption.budget, caption.fit.height + 3);
    const layout = layoutPixelElement('88', undefined, changed, solar);
    assert.ok(layout.primaryFit.height >= 7);
    assert.ok(layout.labelY + layout.labelFit.height <= height);
  }
});

test('fractional resize sizes round to the same device pixel boundary as native export', () => {
  assert.equal(fitPixelText('88', 13.49, 44, 32).height, 7);
  assert.equal(fitPixelText('88', 13.5, 44, 32).height, 14);
  assert.equal(fitCaption(undefined, { ...metric, labelFontSize: 9.49 }, solar).fit.height, 5);
  assert.equal(fitCaption(undefined, { ...metric, labelFontSize: 9.5 }, solar).fit.height, 10);
});

test('centered bitmap cells use the same inward integer origin for odd and even box widths', () => {
  for (const width of [43,44,45,46,47]) {
    const fit=fitPixelText('100,000',23,width,23);
    const left=Math.floor((width-fit.width)/2);
    const markup=pixelTextMarkup(fit,{boxWidth:width,align:'center'});
    const positions=[...markup.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-/g)].map(match=>Number(match[1]));
    assert.ok(positions.every(x=>x>=left&&x+fit.scaleX<=left+fit.width));
    assert.ok(Math.abs(left*2+fit.width-width)<=1);
  }
});
