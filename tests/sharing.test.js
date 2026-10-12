import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEVICES, TEMPLATE_DEFINITIONS, createProject, createElement } from '../web/model.js';
import { encodeShareCode, decodeShareCode, inspectShareCode, SHARE_CODE_LIMITS } from '../web/sharing.js';
import { ELEMENT_TYPE_IDS } from '../web/elements.js';
import { IMPERIAL_UNITS } from '../web/units.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const signedBytes = bytes => `IF1.${Buffer.from(bytes).toString('base64url')}.${createHash('sha256').update(bytes).digest('hex')}`;
const signed = payload => signedBytes(Buffer.from(canonical(payload), 'utf8'));
const getPayload = code => JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString('utf8'));
const reverseKeys = object => Object.fromEntries(Object.entries(object).reverse());

test('share templates preserve unit preferences and legacy checksums without adding defaults', async () => {
  const project = createProject();
  const legacy = await encodeShareCode(project);
  assert.equal(Object.hasOwn(getPayload(legacy).settings, 'units'), false);
  assert.equal(await encodeShareCode(await decodeShareCode(legacy)), legacy);
  project.settings.units = { ...IMPERIAL_UNITS };
  const code = await encodeShareCode(project);
  const decoded = await decodeShareCode(code);
  assert.deepEqual(decoded.settings.units, IMPERIAL_UNITS);
  project.settings.units = reverseKeys(IMPERIAL_UNITS);
  assert.equal(await encodeShareCode(project), code);
  for (const units of [null, [], { shell: 'bad' }, { temperature: '<script>' }, { temperature: { toString: 'bad' } }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    const payload = getPayload(legacy);
    payload.settings.units = units;
    await assert.rejects(decodeShareCode(signed(payload)), /Units|unit/i);
  }
  let called = false;
  const dangerous = Object.defineProperty({}, 'temperature', { enumerable: true, get() { called = true; return 'f'; } });
  await assert.rejects(encodeShareCode({ ...project, settings: { ...project.settings, units: dangerous } }), /ordinary data/);
  assert.equal(called, false);
});

test('starter templates round trip across all devices with independent project identities', async () => {
  for (const template of TEMPLATE_DEFINITIONS) for (const device of Object.keys(DEVICES)) {
    const project = createProject(template.id, device);
    const code = await encodeShareCode(project);
    const decoded = await decodeShareCode(code);
    assert.match(code, /^IF1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    assert.notEqual(decoded.id, project.id);
    assert.equal(decoded.name, project.name);
    assert.equal(decoded.device, project.device);
    assert.deepEqual(decoded.elements, project.elements);
    assert.deepEqual(decoded.settings, project.settings);
    const payload = getPayload(code);
    assert.equal(payload.id, undefined);
    assert.equal(payload.modifiedAt, undefined);
  }
});

test('UTF-8 names and custom text survive sharing as literal data', async () => {
  const project = createProject();
  project.name = 'Café de montagne 🏔️';
  project.elements.push({ ...createElement('text'), text: '東京 · Grüße · 🧭' });
  const decoded = await decodeShareCode(await encodeShareCode(project));
  assert.equal(decoded.name, project.name);
  assert.equal(decoded.elements.at(-1).text, project.elements.at(-1).text);
});

test('encoding is deterministic despite input key order, project ID, or modification date', async () => {
  const project = createProject();
  const reordered = reverseKeys({ ...project, id: 'a-different-project-id', modifiedAt: '2020-01-01T00:00:00Z' });
  reordered.settings = reverseKeys(project.settings);
  reordered.elements = project.elements.map(reverseKeys);
  assert.equal(await encodeShareCode(project), await encodeShareCode(reordered));
});

test('pure JavaScript SHA-256 matches Node crypto over many padding boundaries and UTF-8 values', async () => {
  for (let length = 0; length <= 120; length++) {
    const project = createProject('minimal');
    project.elements.push({ ...createElement('text'), text: 'éx🌟'.repeat(30).slice(0, length) || 'X' });
    const code = await encodeShareCode(project);
    const [, payload, hash] = code.split('.');
    const bytes = Buffer.from(payload, 'base64url');
    assert.equal(hash, createHash('sha256').update(bytes).digest('hex'));
  }
});

test('inspection returns validated project data and portable summary details', async () => {
  const project = createProject('trail');
  const code = await encodeShareCode(project);
  const details = await inspectShareCode(`  ${code}\n`);
  assert.equal(details.name, project.name);
  assert.equal(details.device, project.device);
  assert.equal(details.elementCount, project.elements.length);
  assert.equal(details.hash, code.split('.')[2]);
  assert.equal(details.codeLength, code.length);
});

test('sharing works without Web Crypto as on an ordinary HTTP LAN origin', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const project = createProject('minimal');
    const code = await encodeShareCode(project);
    assert.equal((await decodeShareCode(code)).name, project.name);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('damaged payloads and checksums are rejected', async () => {
  const code = await encodeShareCode(createProject());
  const [prefix, body, hash] = code.split('.');
  const changedHash = `${hash[0] === '0' ? '1' : '0'}${hash.slice(1)}`;
  await assert.rejects(decodeShareCode(`${prefix}.${body}.${changedHash}`), /checksum/);
  const changedBody = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
  await assert.rejects(decodeShareCode(`${prefix}.${changedBody}.${hash}`), /checksum/);
});

test('malformed envelopes, invalid base64url and noncanonical padding bits are rejected', async () => {
  const hash = '0'.repeat(64);
  for (const code of ['', null, `IF2.e30.${hash}`, `IF1.e30=.${hash}`, `IF1.e+0.${hash}`, `IF1.e/0.${hash}`, `IF1.A.${hash}`, `IF1.AB.${hash}`, `IF1.e30.${hash.toUpperCase()}extra`]) {
    await assert.rejects(decodeShareCode(code));
  }
});

test('valid checksums do not authorize invalid UTF-8 or JSON payloads', async () => {
  await assert.rejects(decodeShareCode(signedBytes(Uint8Array.of(255))), /UTF-8 JSON/);
  await assert.rejects(decodeShareCode(signedBytes(Buffer.from('not-json'))), /UTF-8 JSON/);
  const payload = getPayload(await encodeShareCode(createProject()));
  const withBOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical(payload))]);
  await assert.rejects(decodeShareCode(signedBytes(withBOM)), /UTF-8 JSON/);
});

test('unknown structural fields are rejected even with a freshly calculated checksum', async () => {
  const base = getPayload(await encodeShareCode(createProject()));
  for (const key of ['script', 'url', 'svg', 'source', 'filePath', 'import', 'onLoad']) {
    await assert.rejects(decodeShareCode(signed({ ...base, [key]: 'javascript:alert(1)' })), /Unsupported field/);
  }
  const element = structuredClone(base);
  element.elements[0].onClick = 'alert(1)';
  await assert.rejects(decodeShareCode(signed(element)), /Unsupported field/);
  await assert.rejects(decodeShareCode(signed({ ...base, settings: { ...base.settings, fetch: 'https://example.com/code.js' } })), /Unsupported field/);
  await assert.rejects(encodeShareCode({ ...createProject(), source: 'code' }), /Unsupported field/);
});

test('prototype pollution keys are rejected at every structural level', async () => {
  const base = getPayload(await encodeShareCode(createProject()));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    for (const location of ['root', 'element', 'settings']) {
      const payload = structuredClone(base);
      const target = location === 'root' ? payload : location === 'element' ? payload.elements[0] : payload.settings;
      Object.defineProperty(target, key, { value: { polluted: true }, enumerable: true });
      await assert.rejects(decodeShareCode(signed(payload)), /Unsupported field/);
    }
  }
  assert.equal({}.polluted, undefined);
});

test('script-looking text is retained literally without code execution', async () => {
  globalThis.__instinctSharingExecuted = false;
  const project = createProject();
  const text = '<script>globalThis.__instinctSharingExecuted=true</script>';
  project.elements.push({ ...createElement('text'), text });
  const decoded = await decodeShareCode(await encodeShareCode(project));
  assert.equal(decoded.elements.at(-1).text, text);
  assert.equal(globalThis.__instinctSharingExecuted, false);
  delete globalThis.__instinctSharingExecuted;
});

test('oversized envelopes, decoded payloads and encoded designs are rejected before use', async () => {
  await assert.rejects(decodeShareCode('X'.repeat(SHARE_CODE_LIMITS.codeLength + 1)), /64 KiB/);
  await assert.rejects(decodeShareCode(signedBytes(Buffer.alloc(SHARE_CODE_LIMITS.payloadBytes + 1, 32))), /32 KiB/);
  const project = createProject();
  project.elements = Array.from({ length: 100 }, () => ({ ...createElement('text'), text: 'é'.repeat(120) }));
  await assert.rejects(encodeShareCode(project), /32 KiB/);
});

test('element count, duplicate IDs, geometry and field types use model validation', async () => {
  const base = getPayload(await encodeShareCode(createProject()));
  const duplicate = structuredClone(base);
  duplicate.elements[1].id = duplicate.elements[0].id;
  await assert.rejects(decodeShareCode(signed(duplicate)), /unique ID/);
  const oversized = structuredClone(base);
  oversized.elements = Array.from({ length: 101 }, () => ({ ...base.elements[0] }));
  await assert.rejects(decodeShareCode(signed(oversized)), /at most 100/);
  for (const [key, value] of [['type', 'svg'], ['x', -1], ['width', 9999], ['visible', 'true'], ['color', 'url(https://example.com)']]) {
    const payload = structuredClone(base);
    payload.elements[0][key] = value;
    await assert.rejects(decodeShareCode(signed(payload)));
  }
});

test('missing keys, noncanonical JSON and duplicate JSON keys are rejected', async () => {
  const payload = getPayload(await encodeShareCode(createProject()));
  const incomplete = structuredClone(payload);
  delete incomplete.settings.snap;
  await assert.rejects(decodeShareCode(signed(incomplete)), /missing snap/);
  await assert.rejects(decodeShareCode(signedBytes(Buffer.from(JSON.stringify(payload, null, 2)))), /canonical JSON/);
  const duplicate = canonical(payload).replace('"version":1', '"version":1,"version":1');
  await assert.rejects(decodeShareCode(signedBytes(Buffer.from(duplicate))), /canonical JSON/);
});

test('local encode rejects accessor properties and non-data object prototypes', async () => {
  const project = createProject();
  const getterProject = { ...project };
  let executed = false;
  Object.defineProperty(getterProject, 'name', { get() { executed = true; return 'name'; }, enumerable: true });
  await assert.rejects(encodeShareCode(getterProject), /ordinary data/);
  assert.equal(executed, false);
  const getterElement = structuredClone(project);
  Object.defineProperty(getterElement.elements[0], 'type', { get() { executed = true; return 'date'; }, enumerable: true });
  await assert.rejects(encodeShareCode(getterElement), /ordinary data/);
  const getterArray = structuredClone(project);
  Object.defineProperty(getterArray.elements, '0', { get() { executed = true; return project.elements[0]; }, enumerable: true });
  await assert.rejects(encodeShareCode(getterArray), /ordinary data/);
  assert.equal(executed, false);
  await assert.rejects(encodeShareCode(Object.assign(Object.create({ script: true }), project)), /plain data/);
});

test('old IF1 payload checksums remain valid when the optional safety setting is absent', async () => {
  const payload = getPayload(await encodeShareCode(createProject()));
  delete payload.settings.safetyMargin;
  const oldCode = signed(payload);
  const inspected = await inspectShareCode(oldCode);
  assert.equal(inspected.hash, oldCode.split('.')[2]);
  assert.equal(inspected.project.settings.safetyMargin, true);
  assert.deepEqual(inspected.project.elements, payload.elements);
});

test('share codes preserve safety opt-out and reject executable or invalid setting values', async () => {
  const project = createProject();
  project.settings.safetyMargin = false;
  assert.equal((await decodeShareCode(await encodeShareCode(project))).settings.safetyMargin, false);
  const payload = getPayload(await encodeShareCode(project));
  for (const value of ['false', 0, null, { code: 'alert(1)' }]) {
    await assert.rejects(decodeShareCode(signed({ ...payload, settings: { ...payload.settings, safetyMargin: value } })), /Safety margin/);
  }
});

test('caption styling and every trusted element type survive portable code validation', async () => {
  for (const type of ELEMENT_TYPE_IDS) {
    const project = createProject('minimal');
    project.elements = [createElement(type)];
    const decoded = await decodeShareCode(await encodeShareCode(project));
    assert.deepEqual(decoded.elements, project.elements, type);
  }
  const styled = createProject('minimal', 'instinct3amoled45mm');
  Object.assign(styled.elements[0], { labelText: 'CHARGE %', labelFontSize: 10, labelColor: '#aabbcc', labelAlign: 'left', labelGap: 4 });
  assert.deepEqual((await decodeShareCode(await encodeShareCode(styled))).elements, styled.elements);
  styled.elements[0].labelText = '';
  assert.equal((await decodeShareCode(await encodeShareCode(styled))).elements[0].labelText, '');
});

test('caption and graphic fields cannot carry code, unsupported objects, or getters', async () => {
  const project = createProject();
  for (const [key, value] of [['labelText', 'X'.repeat(33)], ['labelText', { code: 'evil' }], ['labelColor', 'url(https://evil)'], ['labelFontSize', 'system()'], ['labelGap', -1], ['labelAlign', 'script']]) {
    await assert.rejects(encodeShareCode({ ...project, elements: [{ ...project.elements[0], [key]: value }] }));
  }
  const withGetter = structuredClone(project);
  let invoked = false;
  Object.defineProperty(withGetter.elements[0], 'labelText', { enumerable: true, get() { invoked = true; return 'BAD'; } });
  await assert.rejects(encodeShareCode(withGetter), /ordinary data/);
  assert.equal(invoked, false);
  for (const [type, field] of [['time', 'source'], ['icon', 'url'], ['progressBar', 'command'], ['circle', 'labelText']]) {
    await assert.rejects(encodeShareCode({ ...project, elements: [{ ...createElement(type), [field]: 'javascript:alert(1)' }] }));
  }
});
