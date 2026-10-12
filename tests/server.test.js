import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { startServer } from '../server.mjs';
import { createElement } from '../web/model.js';
import { ELEMENT_TYPE_IDS } from '../web/elements.js';
import { IMPERIAL_UNITS } from '../web/units.js';

function project(id = 'sample') {
  return {
    version: 1, id, name: `Face ${id}`, device: 'instinct2', background: '#111111',
    elements: [{
      id: 'time-1', type: 'time', x: 10, y: 35, width: 150, height: 40,
      fontSize: 32, align: 'center', color: '#eeeeee', label: false,
      format: '24h', visible: true, locked: false,
    }],
    settings: { grid: true, snap: true, zoom: 1 },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-face-test-'));
  const dataDir = path.join(directory, 'data');
  const webDir = path.join(directory, 'web');
  await mkdir(webDir);
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>Instinctual Face</title>');
  await writeFile(path.join(webDir, 'app.js'), 'export const ready = true;');
  await writeFile(path.join(directory, 'secret.txt'), 'private content');
  await symlink(path.join(directory, 'secret.txt'), path.join(webDir, 'outside.txt'));
  const options = { port: 0, host: '127.0.0.1', dataDir, webDir };
  let app;
  t.after(async () => {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  });
  app = await startServer(options);
  return {
    get url() { return app.url; },
    dataDir,
    async restart() { await app.close(); app = await startServer(options); },
    async request(route, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`${app.url}${route}`, {
        method,
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    },
  };
}

function rawRequest(url, requestPath, method = 'GET') {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: requestPath, method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('saved units survive restart and malformed choices are rejected with client errors', async t => {
  const app = await fixture(t);
  const original = project('units');
  original.settings.units = { ...IMPERIAL_UNITS };
  const saved = await app.request('/api/projects/units', { method: 'PUT', body: original });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.project.settings.units, IMPERIAL_UNITS);
  await app.restart();
  assert.deepEqual((await app.request('/api/projects')).body.projects[0].settings.units, IMPERIAL_UNITS);
  for (const units of [null, [], { command: 'bad' }, { pressure: 'psi' }, { elevation: 3 }]) {
    const response = await app.request('/api/projects/units', { method: 'PUT', body: { ...original, settings: { ...original.settings, units } } });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /Units|unit/i);
  }
  const legacy = await app.request('/api/projects/legacy-units', { method: 'PUT', body: project('legacy-units') });
  assert.equal(Object.hasOwn(legacy.body.project.settings, 'units'), false);
});

test('health and static ES modules are served with appropriate content types', async t => {
  const app = await fixture(t);
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const index = await fetch(app.url);
  assert.match(await index.text(), /Instinctual Face/);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const module = await fetch(`${app.url}/app.js`);
  assert.match(module.headers.get('content-type'), /text\/javascript/);
  assert.match(await module.text(), /export const ready/);
  const head = await fetch(`${app.url}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await app.request('/missing')).status, 404);
});

test('CRUD persists projects and removes them across restarts', async t => {
  const app = await fixture(t);
  assert.deepEqual((await app.request('/api/projects')).body, { projects: [] });
  const created = await app.request('/api/projects/sample', { method: 'PUT', body: project() });
  assert.equal(created.status, 200);
  assert.ok(Number.isFinite(Date.parse(created.body.project.modifiedAt)));
  assert.deepEqual(created.body.project.elements, project().elements);
  const changed = { ...project(), name: 'Updated face', device: 'instinct2x' };
  assert.equal((await app.request('/api/projects/sample', { method: 'PUT', body: changed })).status, 200);
  await app.restart();
  assert.equal((await app.request('/api/projects')).body.projects[0].name, 'Updated face');
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'projects.json'), 'utf8'));
  assert.equal(saved.projects[0].device, 'instinct2x');
  assert.deepEqual((await app.request('/api/projects/sample', { method: 'DELETE' })).body, { ok: true });
  await app.restart();
  assert.deepEqual((await app.request('/api/projects')).body.projects, []);
  assert.equal((await app.request('/api/projects/sample', { method: 'DELETE' })).status, 404);
});

test('concurrent writes do not lose project updates', async t => {
  const app = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => {
    const id = `face-${index}`;
    return app.request(`/api/projects/${id}`, { method: 'PUT', body: project(id) });
  }));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await app.request('/api/projects')).body.projects.length, 24);
  await Promise.all([
    app.request('/api/projects/face-0', { method: 'DELETE' }),
    app.request('/api/projects/face-1', { method: 'PUT', body: { ...project('face-1'), name: 'Latest version' } }),
    app.request('/api/projects/face-new', { method: 'PUT', body: project('face-new') }),
  ]);
  await app.restart();
  const projects = (await app.request('/api/projects')).body.projects;
  assert.equal(projects.length, 24);
  assert.equal(projects.find(item => item.id === 'face-1').name, 'Latest version');
  assert.equal(projects.some(item => item.id === 'face-0'), false);
  assert.equal(projects.some(item => item.id === 'face-new'), true);
});

test('an older delayed edit cannot overwrite a newer saved design', async t => {
  const app = await fixture(t);
  const newer = { ...project(), name: 'Newer edit', modifiedAt: '2026-10-11T12:00:01.000Z' };
  const older = { ...project(), name: 'Older queued edit', modifiedAt: '2026-10-11T12:00:00.000Z' };
  const saved = await app.request('/api/projects/sample', { method: 'PUT', body: newer });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.project.modifiedAt, newer.modifiedAt);
  const delayed = await app.request('/api/projects/sample', { method: 'PUT', body: older });
  assert.equal(delayed.status, 200);
  assert.equal(delayed.body.project.name, newer.name);
  assert.equal(delayed.body.project.modifiedAt, newer.modifiedAt);
  await app.restart();
  const persisted = (await app.request('/api/projects')).body.projects[0];
  assert.equal(persisted.name, newer.name);
  assert.equal(persisted.modifiedAt, newer.modifiedAt);
});

test('invalid project fields and malformed JSON return helpful errors without saving', async t => {
  const app = await fixture(t);
  for (const body of [
    { ...project(), version: 2 },
    { ...project(), id: 'another-id' },
    { ...project(), name: '   ' },
    { ...project(), device: 'unknown' },
    { ...project(), background: '#ff0000' },
    { ...project(), settings: { ...project().settings, zoom: 9 } },
    { ...project(), settings: { ...project().settings, zoom: 0.4 } },
    { ...project(), settings: { ...project().settings, zoom: 1.6 } },
    { ...project(), elements: [{ ...project().elements[0], fontSize: 'large' }] },
    { ...project(), elements: [{ ...project().elements[0], fontSize: 129 }] },
    { ...project(), elements: [{ ...project().elements[0], x: -1 }] },
    { ...project(), elements: [{ ...project().elements[0], x: 30 }] },
    { ...project(), device: 'instinct2s', elements: [{ ...project().elements[0], width: 164 }] },
    { ...project(), device: 'instinct2s', elements: [{ ...project().elements[0], y: 120 }] },
    { ...project(), elements: [{ ...project().elements[0], format: 'long' }] },
    { ...project(), elements: [{ ...project().elements[0], visible: 1 }] },
    { ...project(), elements: [project().elements[0], project().elements[0]] },
    { ...project(), elements: Array(101).fill(project().elements[0]) },
    '{invalid JSON',
    null,
  ]) {
    const result = await app.request('/api/projects/sample', { method: 'PUT', body });
    assert.equal(result.status, 400);
    assert.equal(typeof result.body.error, 'string');
  }
  const wrongType = await app.request('/api/projects/sample', {
    method: 'PUT', body: project(), headers: { 'Content-Type': 'text/plain' },
  });
  assert.equal(wrongType.status, 415);
  assert.deepEqual((await app.request('/api/projects')).body.projects, []);
});

test('oversized request bodies are rejected and subsequent requests work', async t => {
  const app = await fixture(t);
  const result = await app.request('/api/projects/sample', {
    method: 'PUT', body: JSON.stringify({ padding: 'a'.repeat(1024 * 1024) }),
  });
  assert.equal(result.status, 413);
  assert.match(result.body.error, /1 MiB/);
  assert.equal((await app.request('/api/projects/sample', { method: 'PUT', body: project() })).status, 200);
});

test('path traversal and symlinks outside the static directory are blocked', async t => {
  const app = await fixture(t);
  for (const requestPath of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/%5c..%5csecret.txt', '/%00secret.txt', '/%ZZ']) {
    const response = await rawRequest(app.url, requestPath);
    assert.equal(response.status, 400, requestPath);
    assert.doesNotMatch(response.body, /private content/);
  }
  const outside = await rawRequest(app.url, '/outside.txt');
  assert.equal(outside.status, 404);
  assert.doesNotMatch(outside.body, /private content/);
});

test('unsupported API methods and missing endpoints return JSON errors', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/health', { method: 'POST' })).status, 405);
  assert.equal((await app.request('/api/projects', { method: 'POST' })).status, 405);
  assert.equal((await app.request('/api/projects/sample')).status, 405);
  assert.equal((await app.request('/api/missing')).status, 404);
});

test('a corrupt project store fails startup without overwriting saved data', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-face-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, 'data');
  const webDir = path.join(directory, 'web');
  await mkdir(dataDir);
  await mkdir(webDir);
  const file = path.join(dataDir, 'projects.json');
  await writeFile(file, '{not valid');
  await assert.rejects(startServer({ port: 0, dataDir, webDir }), /Cannot read saved projects/);
  assert.equal(await readFile(file, 'utf8'), '{not valid');
});

test('independent captions persist across restart and invalid caption data is rejected', async t => {
  const app = await fixture(t);
  const design = project('caption-fields');
  Object.assign(design.elements[0], { label: true, labelText: 'LOCAL 24H', labelFontSize: 10, labelColor: '#eeeeee', labelAlign: 'right', labelGap: 4 });
  assert.equal((await app.request(`/api/projects/${design.id}`, { method: 'PUT', body: design })).status, 200);
  await app.restart();
  const read = await app.request('/api/projects');
  assert.deepEqual(read.body.projects.find(value => value.id === design.id).elements[0], design.elements[0]);
  for (const [field, value] of [['labelText', 'X'.repeat(33)], ['labelFontSize', 4], ['labelGap', 1.2], ['labelAlign', 'baseline'], ['labelColor', 'url(javascript:evil)']]) {
    const bad = { ...design, elements: [{ ...design.elements[0], [field]: value }] };
    assert.equal((await app.request(`/api/projects/${design.id}`, { method: 'PUT', body: bad })).status, 400, field);
  }
  const after = await app.request('/api/projects');
  assert.deepEqual(after.body.projects.find(value => value.id === design.id).elements[0], design.elements[0]);
});

test('every registered metric and graphic can persist with its trusted fields', async t => {
  const app = await fixture(t);
  const design = project('catalog');
  design.elements = ELEMENT_TYPE_IDS.map(type => createElement(type));
  assert.equal((await app.request(`/api/projects/${design.id}`, { method: 'PUT', body: design })).status, 200);
  const read = await app.request('/api/projects');
  assert.deepEqual(read.body.projects.find(value => value.id === design.id).elements, design.elements);
  for (const [type, field, value] of [['progressBar', 'source', 'file://secret'], ['progressRing', 'goal', -1], ['rectangle', 'strokeWidth', 25], ['icon', 'icon', 'script'], ['circle', 'labelText', 'CAPTION']]) {
    const bad = { ...design, elements: [{ ...createElement(type), [field]: value }] };
    assert.equal((await app.request(`/api/projects/${design.id}`, { method: 'PUT', body: bad })).status, 400, `${type}.${field}`);
  }
});
