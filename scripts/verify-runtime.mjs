/** Isolated runtime smoke check: no saved faces, SDK downloads, credentials, or desktop actions. */
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { createCompiler } from '../compiler.mjs';
import { DEVICES, createElement, createProject } from '../web/model.js';
import { effectiveElement, renderFaceMarkup } from '../web/preview.js';
import { arrangeSelection, moveSelection, selectionIds } from '../web/selection.js';
import { isElementSafe } from '../web/display-safety.js';
import { encodeShareCode, decodeShareCode } from '../web/sharing.js';
import { createSourceZip, generateGarminFiles } from '../web/garmin-export.js';
import { IMPERIAL_UNITS } from '../web/units.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function signed(payload) {
  const bytes = Buffer.from(canonical(payload));
  return `IF1.${bytes.toString('base64url')}.${createHash('sha256').update(bytes).digest('hex')}`;
}

function request(base, route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const client = http.request(`${base}${route}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        bytes: Buffer.concat(chunks), json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      response.on('error', reject);
    });
    client.on('error', reject);
    client.setTimeout(15000, () => client.destroy(new Error('HTTP smoke request timed out')));
    client.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function verifyZip(bytes, expected) {
  const buffer = Buffer.from(bytes), entries = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0, 'source ZIP uses portable stored entries');
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extraLength;
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'ZIP paths remain relative');
    assert.ok(!Object.hasOwn(entries, name), 'ZIP entry names are unique');
    entries[name] = buffer.subarray(start, start + size).toString('utf8');
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'ZIP has a central directory');
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50, 'ZIP has an end record');
  assert.equal(buffer.readUInt16LE(buffer.length - 12), Object.keys(expected).length);
  assert.deepEqual(entries, expected, 'ZIP contains complete generated source and backup');
}

function face(device) {
  const profile = DEVICES[device], project = createProject('minimal', device);
  project.name = `Runtime check ${device}`;
  project.settings.units = { ...IMPERIAL_UNITS };
  project.elements = [[.20, .60, 15], [.35, .64, 17], [.60, .68, 19]].map(([x, y, width], index) => ({
    ...createElement('text', device), x: Math.round(x * profile.width), y: Math.round(y * profile.height),
    width, height: 12, fontSize: 10, text: `VALUE ${index + 1}`, label: true,
    labelText: `CAPTION ${index + 1}`, labelFontSize: 5, labelGap: 1,
  }));
  const bases = project.elements.map(element => effectiveElement(element, profile, true));
  for (const action of ['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'spaceX']) {
    const arranged = arrangeSelection(bases, profile, action, { safetyMargin: true, wholePixels: true });
    assert.equal(arranged.reason, null, `${device}: ${action} is possible`);
    assert.ok(arranged.elements.every(element => isElementSafe(element, profile)), `${device}: ${action} stays safe`);
    assert.deepEqual(arranged.elements.map(e => [e.width, e.height, e.fontSize, e.labelFontSize]),
      bases.map(e => [e.width, e.height, e.fontSize, e.labelFontSize]), `${device}: arrangement preserves sizes`);
  }
  const verticallySpaced = bases.map((element, index) => ({ ...element, x: Math.round(profile.width * .4),
    y: Math.round(profile.height * (.3 + index * .2)) }));
  const vertical = arrangeSelection(verticallySpaced, profile, 'spaceY', { safetyMargin: true, wholePixels: true });
  assert.equal(vertical.reason, null, `${device}: vertical spacing is possible`);
  assert.ok(vertical.elements.every(element => isElementSafe(element, profile)), `${device}: vertical spacing stays safe`);
  const moved = moveSelection(bases, profile, 7, -3, { safetyMargin: true, wholePixels: true });
  assert.ok(moved.changed, `${device}: group movement works`);
  assert.ok(moved.elements.every(element => isElementSafe(element, profile)), `${device}: moved group stays safe`);
  assert.deepEqual(moved.elements.map((e, index) => [e.x - bases[index].x, e.y - bases[index].y]),
    bases.map(() => [moved.dx, moved.dy]), `${device}: movement retains offsets`);
  assert.deepEqual(selectionIds(bases, { x: 0, y: 0, width: profile.width, height: profile.height }),
    bases.map(e => e.id), `${device}: marquee finds the visible group`);
  project.elements = arrangeSelection(bases, profile, 'spaceX', { safetyMargin: true, wholePixels: true }).elements;
  return project;
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-runtime-'));
let app;
const compiler = createCompiler({
  dataDir: directory, sdkPath: path.join(directory, 'absent-sdk'), devicesPath: path.join(directory, 'absent-profiles'),
  environment: { platform: process.platform, arch: process.arch, container: true },
  profileImporter: async () => ({ warnings: [] }),
});
const options = { host: '127.0.0.1', port: 0, dataDir: directory, compiler };
const projects = [], codes = [];
try {
  app = await startServer(options);
  assert.equal((await request(app.url, '/api/health')).json().ok, true);
  const index = await request(app.url, '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  for (const file of ['app.js', 'workflows.js', 'selection.js', 'preview.js', 'units.js', 'styles.css']) {
    const resource = await request(app.url, `/${file}`);
    assert.equal(resource.status, 200, `${file} is served`);
    assert.ok(resource.bytes.length > 0);
  }
  for (const device of Object.keys(DEVICES)) {
    const project = face(device);
    const saved = await request(app.url, `/api/projects/${project.id}`, { method: 'PUT', body: project });
    assert.equal(saved.status, 200);
    const stored = saved.json().project;
    const code = await encodeShareCode(stored), decoded = await decodeShareCode(code);
    assert.deepEqual(decoded.elements, stored.elements);
    assert.deepEqual(decoded.settings, stored.settings);
    const template = await request(app.url, '/api/templates', { method: 'POST', body: { code } });
    assert.equal(template.status, 201);
    assert.equal((await request(app.url, '/api/templates', { method: 'POST', body: { code } })).status, 200);
    const files = generateGarminFiles(stored);
    assert.deepEqual(JSON.parse(files['design.instinctual.json']), stored);
    assert.ok(files['manifest.xml'].includes(`id="${DEVICES[device].id}"`));
    verifyZip(createSourceZip(stored), files);
    const svg = renderFaceMarkup(stored, { editor: false, selectedIds: stored.elements.map(e => e.id),
      selectionBox: { x: 1, y: 1, width: 30, height: 40 } });
    assert.match(svg, /display-mask-/);
    assert.doesNotMatch(svg, /selection-(?:outline|group|marquee)|data-element|data-resize|<script/);
    projects.push(stored); codes.push(code);
  }
  const original = codes[0], parts = original.split('.');
  const badHash = `${parts[0]}.${parts[1]}.${parts[2][0] === '0' ? '1' : '0'}${parts[2].slice(1)}`;
  assert.equal((await request(app.url, '/api/templates', { method: 'POST', body: { code: badHash } })).status, 400);
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal((await request(app.url, '/api/templates', { method: 'POST',
    body: { code: signed({ ...payload, script: 'untrusted' }) } })).status, 400);
  for (const body of [{ ...projects[0], source: 'untrusted' },
    { ...projects[0], elements: [{ ...projects[0].elements[0], script: 'untrusted' }] },
    { ...projects[0], settings: { ...projects[0].settings, command: 'untrusted' } }]) {
    assert.equal((await request(app.url, '/api/build', { method: 'POST', body })).status, 400);
  }
  const missingSdk = await request(app.url, '/api/build', { method: 'POST', body: projects[0] });
  assert.equal(missingSdk.status, 503);
  assert.match(missingSdk.json().error, /SDK is not installed/);
  const status = (await request(app.url, '/api/compiler')).json();
  assert.equal(status.available, false); assert.equal(status.desktopSetupSupported, false);
  for (const headers of [{}, { Origin: 'https://attacker.invalid' },
    { Origin: app.url, 'X-Forwarded-Host': new URL(app.url).host }]) {
    assert.equal((await request(app.url, '/api/compiler/open-manager', { method: 'POST', body: {}, headers })).status, 403);
  }
  const schemaBlocked = await request(app.url, '/api/compiler/desktop-setup', { method: 'POST',
    body: { acceptedLicense: true, command: 'untrusted' }, headers: { Origin: app.url } });
  assert.equal(schemaBlocked.status, 400);
  for (const route of ['/api/compiler/setup', '/api/compiler/refresh']) {
    assert.equal((await request(app.url, route, { method: 'POST', body: { path: '/untrusted' } })).status, 400);
  }
  for (const route of ['/%2e%2e%2fserver.mjs', '/%5c..%5cserver.mjs', '/%00server.mjs']) {
    assert.equal((await request(app.url, route)).status, 400);
  }
  await app.close(); app = null;
  app = await startServer(options);
  const reloaded = (await request(app.url, '/api/projects')).json().projects;
  assert.equal(reloaded.length, projects.length);
  for (const expected of projects) assert.deepEqual(reloaded.find(p => p.id === expected.id), expected);
  assert.deepEqual(new Set((await request(app.url, '/api/templates')).json().templates.map(t => t.code)), new Set(codes));
  for (const project of projects) {
    assert.equal((await request(app.url, `/api/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  }
  assert.deepEqual((await request(app.url, '/api/projects')).json().projects, []);
  console.log(`Runtime smoke check passed: ${projects.length} profiles; 8 arrangement controls; group movement and marquee; save/restart/delete; share/dedup/restart; complete source ZIPs and SVGs; injected data, unsafe desktop requests, and traversal rejected.`);
  console.log('Native SDK compilation and browser gestures require their separate checks; this isolated check does not download tools or launch desktop applications.');
} finally {
  try { await app?.close(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
