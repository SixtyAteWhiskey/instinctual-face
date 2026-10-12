import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateGarminFiles, createSourceZip, GARMIN_DEVICES } from '../web/garmin-export.js';
import { fitPixelText, pixelTextMarkup, layoutPixelElement, PRIMARY_GLYPHS, TINY_GLYPHS } from '../web/pixel-font.js';
import { ELEMENT_TYPE_IDS, ELEMENT_DEFINITIONS } from '../web/elements.js';
import { analyzeElement, constrainElement, pixelRectangle, isElementSafe } from '../web/display-safety.js';
import { IMPERIAL_UNITS, UNIT_DEFINITIONS, conversion, unitCaption } from '../web/units.js';
import { metricExpression, unitNumberExpression } from '../web/garmin-metrics.js';

const layer = (type, overrides = {}) => ({
  id: `layer-${type}`, type, x: 20, y: 38, width: 136, height: 50, fontSize: 28,
  align: 'center', color: '#eeeeee', visible: true, label: false, ...overrides,
});
const project = (overrides = {}) => ({
  version: 1, id: 'a9eb87bd-9b92-40df-a573-c1732c701874', name: 'Trail Face', device: 'instinct2',
  background: '#111111', elements: [layer('time', { format: '24h' })],
  settings: { grid: true, snap: true, zoom: 2 }, ...overrides,
});

test('exports complete projects for official device IDs and Connect IQ dimensions', () => {
  const expected = {
    instinct2: [176, 176], instinct2s: [163, 156], instinct2x: [176, 176],
    instinct3solar45mm: [176, 176], instinct3solar50mm: [176, 176],
    instinct3amoled45mm: [390, 390], instinct3amoled50mm: [416, 416],
    instinctcrossover: [176, 176], instinctcrossoveramoled: [390, 390],
    instincte40mm: [166, 166], instincte45mm: [176, 176],
  };
  assert.deepEqual(Object.keys(GARMIN_DEVICES), Object.keys(expected));
  for (const [id, size] of Object.entries(expected)) {
    const files = generateGarminFiles(project({ device: id }));
    assert.deepEqual([GARMIN_DEVICES[id].width, GARMIN_DEVICES[id].height], size);
    assert.match(files['manifest.xml'], new RegExp(`<iq:product id="${id === 'instinct3solar50mm' ? 'instinct3solar45mm' : id}"`));
    assert.match(files['manifest.xml'], /type="watchface"/);
    assert.match(files['manifest.xml'], /id="a9eb87bd9b9240dfa573c1732c701874"/);
    assert.match(files['source/InstinctualFaceView.mc'], new RegExp(`${size[0]} x ${size[1]}`));
    assert.match(files['monkey.jungle'], /base\.sourcePath = source/);
    assert.match(files['resources/drawables/drawables.xml'], /filename="launcher_icon.svg"/);
    assert.match(files['resources/drawables/launcher_icon.svg'], /<svg /);
    assert.match(files['resources/drawables/launcher_icon.svg'], new RegExp(`width="${GARMIN_DEVICES[id].launcherIconSize}" height="${GARMIN_DEVICES[id].launcherIconSize}"`));
    assert.deepEqual(JSON.parse(files['design.instinctual.json']), project({ device: id }));
    assert.match(files['README.md'], /not a compiled watch app/);
    assert.ok(Object.values(files).every(value => typeof value === 'string'));
  }
});

test('uses actual time, activity, battery, history and correct centimeters conversion', () => {
  const design = project({ elements: ['time', 'date', 'steps', 'heart', 'battery', 'calories', 'floors', 'distance'].map(type => layer(type, { label: true, format: '12h' })) });
  const source = generateGarminFiles(design)['source/InstinctualFaceView.mc'];
  assert.match(source, /var clock = System\.getClockTime\(\)/);
  assert.match(source, /var date = Gregorian\.info\(Time\.now\(\), Time\.FORMAT_SHORT\)/);
  assert.match(source, /var activity = ActivityMonitor\.getInfo\(\)/);
  assert.match(source, /var stats = System\.getSystemStats\(\)/);
  assert.match(source, /ActivityMonitor\.getHeartRateHistory\(1, true\)/);
  assert.match(source, /sample\.heartRate != ActivityMonitor\.INVALID_HR_SAMPLE/);
  assert.match(source, /activity has :floorsClimbed/);
  assert.match(source, /if \(value == null\) \{ return "--"; \}/);
  assert.ok(source.includes(unitNumberExpression('activity.distance', 'distance', undefined, 1, false, 100000)));
  assert.match(source, /places == 2 \? "%02d" : "%d"/);
  assert.match(source, /timeText\(clock, true\), "TIME"/);
  assert.match(source, /numberText\(heartRate, false\), "BPM"/);
  assert.match(source, /numberText\(activity\.steps, true\), "STEPS"/);
  assert.match(source, /batteryText\(stats\.battery\), "BATTERY"/);
  assert.match(source, /function batteryText\(value\) \{\s+if \(value == null\) \{ return "--"; \}\s+return numberText\(value, false\) \+ "%";/);
  assert.doesNotMatch(source, /Sensor\.enable|Timer\.Timer/);
});

test('preserves pixel positions when safety is disabled, layer order and alignment', () => {
  const design = project({ settings: { safetyMargin: false }, elements: [
    layer('text', { x: 5, y: 12, width: 60, height: 20, fontSize: 16, align: 'left', text: 'LEFT' }),
    layer('text', { x: 9, y: 35, width: 80, height: 30, align: 'right', text: 'RIGHT', color: '#111111' }),
    layer('line', { x: 11, y: 80, width: 130, height: 2 }),
    layer('circle', { x: 124, y: 8, width: 40, height: 40 }),
    layer('text', { visible: false, text: 'HIDDEN' }),
  ] });
  const source = generateGarminFiles(design)['source/InstinctualFaceView.mc'];
  assert.match(source, /drawLabel\(dc, 5, 5, 12, 60, 20, 16, "LEFT", "", Graphics\.TEXT_JUSTIFY_LEFT, false, false, 5, Graphics\.COLOR_WHITE, Graphics\.TEXT_JUSTIFY_LEFT, 3, 1\)/);
  assert.match(source, /drawLabel\(dc, 89, 9, 35, 80, 30, 28, "RIGHT", "", Graphics\.TEXT_JUSTIFY_RIGHT, false, false, 5, Graphics\.COLOR_BLACK, Graphics\.TEXT_JUSTIFY_RIGHT, 3, 1\)/);
  assert.match(source, /dc\.fillRectangle\(11, 80, 130, 2\)/);
  assert.match(source, /dc\.drawEllipse\(144, 28, 19, 19\)/);
  assert.match(source, /dc\.setColor\(Graphics\.COLOR_BLACK, Graphics\.COLOR_TRANSPARENT\)/);
  assert.match(source, /dc\.setClip\(x, y, width, height\)/);
  assert.ok(source.indexOf('"LEFT"') < source.indexOf('"RIGHT"'));
  assert.doesNotMatch(source, /HIDDEN/);
  assert.doesNotMatch(source, /var activity =/);
});

test('escapes user text in XML and Monkey C without executable interpolation', () => {
  const attack = '"; System.println("injected"); //\nC:\\trail\t<face>&';
  const files = generateGarminFiles(project({ name: '<Face>&"\'\u0000', elements: [layer('text', { text: attack })] }));
  assert.match(files['resources/strings/strings.xml'], /<string id="AppName">Faceand<\/string>/);
  assert.equal(JSON.parse(files['design.instinctual.json']).name, '<Face>&"\'\u0000');
  assert.doesNotMatch(files['resources/strings/strings.xml'], /&(amp|lt|gt|quot|apos);/);
  assert.doesNotMatch(files['resources/strings/strings.xml'], /\u0000/);
  assert.ok(files['source/InstinctualFaceView.mc'].includes('"\\"; System.println(\\"injected\\"); //\\nC:\\\\trail\\t<face>&"'));
  assert.equal(JSON.parse(files['design.instinctual.json']).elements[0].text, attack);
  assert.ok(Object.keys(files).every(path => !path.startsWith('/') && !path.includes('..')));
});

test('tiny fixed pixel labels preserve a usable primary font budget', () => {
  const source = generateGarminFiles(project({ elements: [layer('steps', { label: true, height: 30 }), layer('time', { height: 35 })] }))['source/InstinctualFaceView.mc'];
  assert.match(source, /function closestFont\(dc, target, numeric, maxHeight, maxWidth, value\)/);
  assert.match(source, /fontHeight <= maxHeight && fontWidth <= maxWidth/);
  assert.match(source, /if \(!found\) \{ return null; \}/);
  assert.match(source, /var _labelScale = 1/);
  assert.match(source, /available -= captionBudget/);
  assert.match(source, /var captionHeight = height - 7 - captionGap - captionPadding/);
  assert.match(source, /font = closestFont\(dc, size, numeric, available, width, value\)/);
  assert.match(source, /dc\.setClip\(x, y, width, height\)/);
  assert.match(source, /var available = height/);
  assert.match(source, /drawBitmap\(dc, x, top \+ primaryHeight \+ captionGap, caption, captionJustify, true, width\)/);
  assert.match(source, /rows\[row\] & \(1 << \(columns - column - 1\)\)/);
  assert.match(source, /dc\.fillRectangle\(x \+ \(letter \* \(columns \+ 1\) \+ column\) \* scaleX/);
  assert.doesNotMatch(source, /var labelFont/);
  assert.equal(30 - 7 - 2, 21, 'A default 30px metric retains room for the 21px Instinct 2 primary font');
  assert.ok('0123456789%:,/-'.split('').every(key => TINY_GLYPHS[key]), 'Captions support numeric/punctuation text');
  for (const [character, rows] of Object.entries(TINY_GLYPHS)) {
    assert.equal(rows.length, 5, character);
    assert.ok(rows.every(row => row >= 0 && row <= 7), character);
  }
  for (const [character, rows] of Object.entries(PRIMARY_GLYPHS)) {
    assert.equal(rows.length, 7, character);
    assert.ok(rows.every(row => row >= 0 && row <= 31), character);
  }
  const amoled = generateGarminFiles(project({ device: 'instinct3amoled45mm' }))['source/InstinctualFaceView.mc'];
  assert.match(amoled, /var _labelScale = 2/);
});

test('live text fits both layer dimensions without retaining changing readings', () => {
  const source = generateGarminFiles(project({ device: 'instinct3solar50mm', elements: [
    layer('steps', { width: 53, height: 32, fontSize: 23, label: true }),
    layer('time', { width: 103, height: 44, fontSize: 40, format: '24h' }),
  ] }))['source/InstinctualFaceView.mc'];
  assert.match(source, /numberText\(activity\.steps, true\), "STEPS"/);
  assert.match(source, /dc\.getTextWidthInPixels\(value, choices\[i\]\)/);
  assert.match(source, /fontHeight <= maxHeight && fontWidth <= maxWidth/);
  assert.match(source, /closestFont\(dc, size, numeric, available, width, value\)/);
  assert.match(source, /if \(font == null\) \{/);
  assert.match(source, /primary = fitBitmap\(value, size, width, available, false\)/);
  assert.doesNotMatch(source, /_fontCache/);
});

test('enabled safety shares the exact inward-rounded circle rectangle and pixel font', () => {
  const steps = layer('steps', { x: 118, y: 15, width: 53, height: 32, fontSize: 23, label: true });
  const design = project({ device: 'instinct3solar50mm', elements: [steps] });
  const bounds = GARMIN_DEVICES[design.device];
  const safe = pixelRectangle(constrainElement(steps, bounds, { safetyMargin: true }));
  assert.ok(isElementSafe(safe, bounds));
  assert.equal(analyzeElement(safe, bounds).region, 'subscreen');
  const source = generateGarminFiles(design)['source/InstinctualFaceView.mc'];
  assert.ok(source.includes(`drawLabel(dc, ${safe.x + Math.floor(safe.width / 2)}, ${safe.x}, ${safe.y}, ${safe.width}, ${safe.height}, 23, numberText(activity.steps, true), "STEPS", Graphics.TEXT_JUSTIFY_CENTER, false, true, 5, Graphics.COLOR_WHITE, Graphics.TEXT_JUSTIFY_CENTER, 3, 1);`));
  const disabled = generateGarminFiles({ ...design, settings: { safetyMargin: false } })['source/InstinctualFaceView.mc'];
  assert.match(disabled, /drawLabel\(dc, 144, 118, 15, 53, 32, 23, numberText\(activity\.steps, true\), "STEPS", Graphics\.TEXT_JUSTIFY_CENTER, false, false, 5, Graphics\.COLOR_WHITE, Graphics\.TEXT_JUSTIFY_CENTER, 3, 1\)/);
  assert.deepEqual(JSON.parse(generateGarminFiles(design)['design.instinctual.json']), design, 'Export keeps the editable original geometry');
});

test('compact numeric text remains tall and completely visible as readings grow', () => {
  for (const width of [41, 45, 47, 53]) for (const value of ['0', '--', '12,345', '100,000', '100%', '999', '12.3', '23:59']) {
    const fit = fitPixelText(value, 23, width, 23);
    assert.equal(fit.text, value);
    assert.equal(fit.truncated, false);
    assert.equal(fit.height, 21);
    assert.ok(fit.width <= width);
    assert.ok(fit.scaleX <= fit.scaleY);
    assert.equal(fit.replaced, false);
  }
  const tall = fitPixelText('100,000', 23, 47, 23);
  assert.deepEqual([tall.width, tall.height, tall.scaleX, tall.scaleY], [41, 21, 1, 3]);
  const layout = layoutPixelElement('100,000', 'STEPS', { type: 'steps', label: true, width: 47, height: 32, fontSize: 23 }, GARMIN_DEVICES.instinct3solar50mm);
  assert.deepEqual([layout.primaryY, layout.labelY, layout.primaryFit.height, layout.labelFit.height], [1, 25, 21, 5]);
  assert.ok(layout.labelY + layout.labelFit.height <= 32);
});

test('long captions and unsupported compact text stay inside tiny rectangles', () => {
  const fits = [
    fitPixelText('A VERY LONG CUSTOM TITLE', 23, 41, 23),
    fitPixelText('BATTERY', 5, 19, 5, { tiny: true }),
    fitPixelText('Café 🌲', 14, 47, 14),
    fitPixelText('123', 14, 11, 14),
  ];
  assert.equal(fits[0].text, 'A VE...');
  assert.equal(fits[1].text, 'BA...');
  assert.equal(fits[2].text, 'CAF? ?');
  assert.equal(fits[2].replaced, true);
  assert.equal(fits[3].text, '..');
  for (const [index, fit] of fits.entries()) {
    const budget = [41, 19, 47, 11][index];
    assert.ok(fit.width <= budget);
    const markup = pixelTextMarkup(fit, { boxWidth: budget, color: '#eeeeee' });
    for (const match of markup.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-/g)) {
      assert.ok(Number(match[1]) + Number(match[3]) <= budget);
      assert.ok(Number(match[2]) + Number(match[4]) <= fit.height);
    }
  }
  assert.equal(fitPixelText('0', 20, 3, 6).text, '', 'Below the readable bitmap minimum nothing is cropped');
  assert.throws(() => pixelTextMarkup(fits[0], { color: '\" onload=\"alert(1)' }), /hexadecimal/);
});

test('AMOLED exports validated RGB colors and separate conservative always-on rendering', () => {
  const design = project({ device: 'instinct3amoled50mm', background: '#AbCDef', elements: [layer('time', { color: '#fF7531', format: '12h' })] });
  const source = generateGarminFiles(design)['source/InstinctualFaceView.mc'];
  assert.match(source, /dc\.setColor\(0xABCDEF, 0xABCDEF\)/);
  assert.match(source, /dc\.setColor\(0xFF7531, Graphics\.COLOR_TRANSPARENT\)/);
  assert.match(source, /function onEnterSleep\(\) \{\s+_sleeping = true/);
  assert.match(source, /function onExitSleep\(\) \{\s+_sleeping = false/);
  assert.match(source, /if \(_sleeping\) \{ drawAlwaysOn\(dc\); return; \}/);
  const alwaysOn = source.slice(source.indexOf('    function drawAlwaysOn('), source.indexOf('    function timeText('));
  assert.match(alwaysOn, /dc\.setColor\(Graphics\.COLOR_BLACK, Graphics\.COLOR_BLACK\)/);
  assert.match(alwaysOn, /dc\.setColor\(0x555555, Graphics\.COLOR_TRANSPARENT\)/);
  assert.match(alwaysOn, /dc\.setClip\(x, y, boxWidth, boxHeight\)/);
  assert.match(alwaysOn, /clock\.min % 2 == 0 \? 0\.32 : 0\.62/);
  assert.match(alwaysOn, /timeText\(clock, true\)/);
  assert.match(alwaysOn, /closestFont\(dc, boxHeight, true, boxHeight, boxWidth, value\)/);
  assert.doesNotMatch(alwaysOn, /ActivityMonitor|0xABCDEF|0xFF7531/);
  for (const size of [390, 416]) {
    const width = Math.trunc(size * 0.45);
    const height = Math.trunc(size * 0.12);
    assert.ok(width * height / (Math.PI * (size / 2) ** 2) < 0.07);
    assert.ok(Math.trunc(size * 0.32) + height < Math.trunc(size * 0.62));
  }
  assert.doesNotMatch(generateGarminFiles(project())['source/InstinctualFaceView.mc'], /drawAlwaysOn|onEnterSleep/);
});

test('rejects unsupported devices, schema versions, excessive layers and numeric injection', () => {
  assert.throws(() => generateGarminFiles(project({ device: 'instinct' })), /Unsupported Garmin device/);
  assert.throws(() => generateGarminFiles(project({ device: '__proto__' })), /Unsupported Garmin device/);
  assert.throws(() => generateGarminFiles(project({ version: 99 })), /version 1/);
  assert.throws(() => generateGarminFiles(project({ elements: Array.from({ length: 101 }, () => layer('time')) })), /100 layers/);
  assert.throws(() => generateGarminFiles(project({ elements: [layer('text', { x: '0); injected();' })] })), /Invalid x/);
  assert.throws(() => generateGarminFiles(project({ elements: [layer('text', { fontSize: Infinity })] })), /Invalid fontSize/);
  assert.throws(() => generateGarminFiles(project({ elements: [layer('unsupported')] })), /Unsupported element/);
  for (const color of ['red', '#abc', '#abcdef); injected();', '#gggggg']) {
    assert.throws(() => generateGarminFiles(project({ device: 'instinct3amoled45mm', background: color })), /Invalid color/);
    assert.throws(() => generateGarminFiles(project({ device: 'instinct3amoled45mm', elements: [layer('text', { color })] })), /Invalid color/);
  }
  assert.throws(() => generateGarminFiles(project({ background: '#ff0000' })), /Invalid color/);
});

test('non-UUID project identity creates a stable valid app ID independent of name changes', () => {
  const getId = design => generateGarminFiles(design)['manifest.xml'].match(/application id="([a-f\d]+)"/)[1];
  const id = getId(project({ id: 'local-design-17' }));
  assert.match(id, /^[a-f\d]{32}$/);
  assert.equal(id, getId(project({ id: 'local-design-17', name: 'Renamed' })));
  assert.notEqual(id, getId(project({ id: 'local-design-18' })));
});

test('ZIP is deterministic, extractable by Python zipfile and every entry passes CRC checks', () => {
  const design = project({ name: 'Face 🏔', elements: [layer('text', { text: 'Café & trail' })] });
  const archive = createSourceZip(design);
  assert.ok(archive instanceof Uint8Array);
  assert.deepEqual(archive, createSourceZip(design));
  const temporary = mkdtempSync(join(tmpdir(), 'instinctual-export-'));
  try {
    const path = join(temporary, 'source.zip');
    writeFileSync(path, archive);
    const result = spawnSync('python3', ['-c', [
      'import sys, json, zipfile, hashlib',
      'with zipfile.ZipFile(sys.argv[1]) as archive:',
      '  assert archive.testzip() is None',
      '  assert all(entry.compress_type == zipfile.ZIP_STORED for entry in archive.infolist())',
      '  assert all(entry.flag_bits & 0x800 for entry in archive.infolist())',
      '  extracted = {name: archive.read(name) for name in archive.namelist()}',
      '  assert all(data.decode("utf-8") is not None for data in extracted.values())',
      '  print(json.dumps({name: hashlib.sha256(data).hexdigest() for name, data in extracted.items()}))',
    ].join('\n'), path], { maxBuffer: 1024 * 1024, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr?.toString());
    const expected = Object.fromEntries(Object.entries(generateGarminFiles(design)).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')]));
    assert.deepEqual(JSON.parse(result.stdout.toString()), expected);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('exports all 96 trusted element types for every target with guarded optional data', () => {
  assert.equal(ELEMENT_TYPE_IDS.length,96);
  const elements=ELEMENT_TYPE_IDS.map(type=>layer(type,{ ...ELEMENT_DEFINITIONS[type].defaults }));
  for(const device of Object.keys(GARMIN_DEVICES)) {
    const files=generateGarminFiles(project({device,elements}));
    const source=files['source/InstinctualFaceView.mc'];
    for(const type of ELEMENT_TYPE_IDS) assert.ok(source.includes(`: ${type}\n`), `${device}: ${type}`);
    assert.match(source,/SensorHistory\.getBodyBatteryHistory\(\{ :period => 1, :order => SensorHistory\.ORDER_NEWEST_FIRST \}\)/);
    assert.match(source,/if \(sample == null \|\| sample\.data == null\) \{ return null; \}/);
    assert.match(source,/catch \(error\) \{ return null; \}/);
    assert.match(source,/i < forecasts\.size\(\) && i < 10/);
    assert.match(source,/drawGraphicIcon\(dc, .*\[/);
    assert.match(source,/drawProgressRing\(dc,/);
    assert.doesNotMatch(source,/Sensor\.enable|Position\.enable|Timer\.Timer/);
  }
});

test('requests only visible selected permissions and handles unsupported native complications', () => {
  const files=types=>generateGarminFiles(project({elements:types.map(type=>layer(type)),device:'instinct3solar50mm'}));
  assert.match(files(['time','steps','heart','weather'])['manifest.xml'],/<iq:permissions \/>/);
  assert.match(files(['bodyBattery'])['manifest.xml'],/<iq:uses-permission id="SensorHistory"/);
  assert.doesNotMatch(files(['bodyBattery'])['manifest.xml'],/UserProfile|Positioning|ComplicationSubscriber/);
  assert.match(files(['weight'])['manifest.xml'],/<iq:uses-permission id="UserProfile"/);
  assert.match(files(['sunrise'])['manifest.xml'],/<iq:uses-permission id="Positioning"/);
  assert.match(files(['sleepScore'])['manifest.xml'],/<iq:uses-permission id="ComplicationSubscriber"/);
  const solar=files(['sleepScore'])['source/InstinctualFaceView.mc'];
  assert.match(solar,/Complications has :COMPLICATION_TYPE_SLEEP_SCORE/);
  assert.match(solar,/data == null \? null : data\.value/);
  const legacy=generateGarminFiles(project({elements:[layer('sleepScore')]}));
  assert.match(legacy['manifest.xml'],/<iq:permissions \/>/);
  assert.doesNotMatch(legacy['source/InstinctualFaceView.mc'],/using Toybox\.Complications|function nativeComplication/);
  assert.match(legacy['source/InstinctualFaceView.mc'],/28, "--", ""/);
  const hidden=generateGarminFiles(project({elements:[layer('bodyBattery',{visible:false})]}));
  assert.match(hidden['manifest.xml'],/<iq:permissions \/>/);
  assert.doesNotMatch(hidden['source/InstinctualFaceView.mc'],/using Toybox\.SensorHistory/);
});

test('independent captions escape custom text and serialize fixed numeric styling', () => {
  const attack='"; injected(); //';
  const face=project({device:'instinct3amoled45mm',elements:[layer('steps',{
    label:true,labelText:attack,labelFontSize:10,labelGap:0,labelAlign:'right',labelColor:'#336699'
  })]});
  const source=generateGarminFiles(face)['source/InstinctualFaceView.mc'];
  assert.ok(source.includes('"\\"; injected(); //"'));
  assert.match(source,/false, false, 10, 0x336699, Graphics\.TEXT_JUSTIFY_RIGHT, 0, 2\)/);
  assert.match(source,/dc\.setColor\(captionColor, Graphics\.COLOR_TRANSPARENT\)/);
  assert.match(source,/captionBudget = caption\[4\] \+ captionGap \+ captionPadding/);
  for(const invalid of [{labelFontSize:'5); injected();'},{labelFontSize:4},{labelGap:33},{labelGap:Infinity},{labelColor:'red'}]) {
    assert.throws(()=>generateGarminFiles(project({elements:[layer('steps',{label:true,...invalid})]})),/Invalid/);
  }
});

test('progress uses trusted guarded native values, canonical goals and SI distance', () => {
  const face=project({elements:[layer('progressBar',{source:'calories',goal:0}),layer('progressRing',{source:'distance',goal:12})]});
  const source=generateGarminFiles(face)['source/InstinctualFaceView.mc'];
  assert.match(source,/activity\.calories : null\), 2000, 0, 2000\)/);
  assert.match(source,/activity\.distance \/ 100000\.0 : null\), 10, 12, 10\)/);
  assert.match(source,/var activity = ActivityMonitor\.getInfo/);
  assert.match(source,/if \(fraction <= 0\) \{ return; \}/);
  assert.match(source,/if \(fraction >= 1\) \{ dc\.drawCircle/);
  assert.match(source,/if \(sweep > 359\) \{ sweep = 359; \}/);
  const wind=generateGarminFiles(project({elements:[layer('windSpeed')]}))['source/InstinctualFaceView.mc'];
  assert.ok(wind.includes(unitNumberExpression('(weather != null && (weather has :windSpeed) ? weather.windSpeed : null)', 'speed', undefined, 0, false, 1 / 3.6)));
});

test('selected units convert documented Garmin raw values and default captions together', () => {
  const types = ['distance', 'temperature', 'sensorTemperature', 'altitude', 'ascent', 'descent', 'visibility', 'windSpeed', 'pressure', 'weatherPressure', 'weight', 'userHeight', 'weeklyRun', 'weeklyBike', 'racePace5k', 'temperatureRange'];
  const design = project({ device: 'instinct3solar50mm', settings: { units: IMPERIAL_UNITS }, elements: types.map(type => layer(type, { label: true })) });
  const source = generateGarminFiles(design)['source/InstinctualFaceView.mc'];
  for (const type of types) assert.ok(source.includes(`"${unitCaption(type, IMPERIAL_UNITS)}"`), type);
  assert.ok(source.includes(unitNumberExpression('activity.distance', 'distance', IMPERIAL_UNITS, 1, false, 100000)), 'Daily distance is centimeters, not meters');
  for (const type of types.filter(type => type !== 'distance')) assert.ok(source.includes(metricExpression({ type }, GARMIN_DEVICES.instinct3solar50mm, IMPERIAL_UNITS)), type);
  assert.match(source, /unitPaceText\(nativeComplication\("racePace5k"\), 1609\.344d\)/);
  assert.match(source, /unitHeightText\(\(profile != null && \(profile has :height\) \? profile\.height : null\)\)/);
  assert.match(source, /if \(value == null\) \{ return "--"; \}\s+var converted = value\.toDouble\(\) \* factor \+ offset/);
  assert.match(source, /magnitude \* scale \+ 0\.5d \+ 0\.000000001d/);
  assert.match(source, /converted < 0 && rounded != 0 \? "-" \+ text : text/);
  assert.match(source, /centimeters\.toDouble\(\) \/ 2\.54d \+ 0\.5d/);
  assert.match(source, /distanceMeters \/ speed\.toDouble\(\) \+ 0\.5d/);
  assert.match(source, /seconds % 60/);
  assert.deepEqual(JSON.parse(generateGarminFiles(design)['design.instinctual.json']).settings.units, IMPERIAL_UNITS);
});

test('mixed unit choices work independently and preserve custom captions', () => {
  for (const definition of UNIT_DEFINITIONS) for (const [choice] of definition.options) {
    const units = { [definition.category]: choice };
    const types = { temperature: 'temperature', distance: 'distance', elevation: 'altitude', speed: 'windSpeed', pressure: 'weatherPressure', weight: 'weight', height: 'userHeight' };
    const type = types[definition.category];
    const source = generateGarminFiles(project({ elements: [layer(type, { label: true })], settings: { units } }))['source/InstinctualFaceView.mc'];
    assert.ok(source.includes(`"${unitCaption(type, units)}"`), `${type}:${choice}`);
    const custom = generateGarminFiles(project({ elements: [layer(type, { label: true, labelText: 'MY LABEL' })], settings: { units } }))['source/InstinctualFaceView.mc'];
    assert.ok(custom.includes('"MY LABEL"'));
  }
  const unsupported = generateGarminFiles(project({ elements: [layer('weeklyRun', { label: true })], settings: { units: { distance: 'mi' } } }))['source/InstinctualFaceView.mc'];
  assert.match(unsupported, /28, "--", "RUN MI"/);
  assert.doesNotMatch(unsupported, /using Toybox.Complications/);
  const progress = generateGarminFiles(project({ elements: [layer('progressRing', { source: 'distance', goal: 8.04672 })], settings: { units: IMPERIAL_UNITS } }))['source/InstinctualFaceView.mc'];
  assert.match(progress, /activity\.distance \/ 100000\.0 : null\), 10, 8\.04672, 10/);
  assert.deepEqual(conversion('temperature', { temperature: 'f' }), { factor: 1.8, offset: 32 });
});

test('unit preferences are finite trusted enumerations rather than generated source', () => {
  for (const units of [{ temperature: 'f); injected();' }, { elevation: 'yards' }, { source: 'code' }, [], null]) {
    assert.throws(() => generateGarminFiles(project({ settings: { units } })), /Unsupported|Units/);
  }
});
