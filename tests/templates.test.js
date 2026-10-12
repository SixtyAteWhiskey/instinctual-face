import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createTemplateStore } from '../templates.mjs';
import { startServer } from '../server.mjs';
import { createProject, createElement } from '../web/model.js';
import { encodeShareCode, inspectShareCode, SHARE_CODE_LIMITS } from '../web/sharing.js';

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const signed = payload => {
  const bytes = Buffer.from(canonical(payload));
  return `IF1.${bytes.toString('base64url')}.${createHash('sha256').update(bytes).digest('hex')}`;
};

async function directory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-face-templates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fixture(t) {
  const root = await directory(t);
  const dataDir = path.join(root, 'data');
  const webDir = path.join(root, 'web');
  await mkdir(webDir);
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>Instinctual Face</title>');
  const options = { port: 0, host: '127.0.0.1', dataDir, webDir };
  let app = await startServer(options);
  t.after(() => app.close());
  return {
    dataDir,
    async restart() { await app.close(); app = await startServer(options); },
    async request({ method = 'GET', body, headers } = {}) {
      const response = await fetch(`${app.url}/api/templates`, {
        method, headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('template API stores validated layouts, deduplicates hashes, and persists across restart', async t => {
  const app = await fixture(t);
  assert.deepEqual((await app.request()).body, { templates: [] });
  const project = createProject();
  const code = await encodeShareCode(project);
  const added = await app.request({ method: 'POST', body: { code } });
  assert.equal(added.status, 201);
  assert.equal(added.body.created, true);
  const template = added.body.template;
  assert.deepEqual(Object.keys(template).sort(), ['code', 'createdAt', 'device', 'elementCount', 'hash', 'name']);
  assert.equal(template.hash, code.split('.')[2]);
  assert.equal(template.name, project.name);
  assert.equal(template.device, project.device);
  assert.equal(template.elementCount, project.elements.length);
  assert.equal(template.code, code);
  assert.ok(Number.isFinite(Date.parse(template.createdAt)));
  const duplicate = await app.request({ method: 'POST', body: { code: `  ${code}\n` } });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);
  assert.deepEqual(duplicate.body.template, template);
  await app.restart();
  assert.deepEqual((await app.request()).body.templates, [template]);
  const saved = JSON.parse(await readFile(path.join(app.dataDir, 'templates.json'), 'utf8'));
  assert.deepEqual(saved, { version: 1, templates: [template] });
});

test('concurrent template additions and duplicates retain every unique hash', async t => {
  const app = await fixture(t);
  const codes = await Promise.all(Array.from({ length: 16 }, (_, index) => encodeShareCode({ ...createProject(), name: `Template ${index}` })));
  const responses = await Promise.all([...codes, ...Array(8).fill(codes[0])].map(code => app.request({ method: 'POST', body: { code } })));
  assert.equal(responses.filter(result => result.status === 201).length, codes.length);
  assert.ok(responses.every(result => [200, 201].includes(result.status)));
  assert.equal((await app.request()).body.templates.length, codes.length);
  await app.restart();
  assert.deepEqual(new Set((await app.request()).body.templates.map(template => template.hash)), new Set(codes.map(code => code.split('.')[2])));
});

test('template POST accepts only a bounded code field and supported methods', async t => {
  const app = await fixture(t);
  const code = await encodeShareCode(createProject());
  for (const body of [null, [], {}, { code, source: 'code' }, { code: 5 }, { code: 'IF1.not.valid' }, JSON.parse(`{"code":${JSON.stringify(code)},"__proto__":{"polluted":true}}`)]) {
    const result = await app.request({ method: 'POST', body });
    assert.equal(result.status, 400);
    assert.equal(typeof result.body.error, 'string');
  }
  assert.equal((await app.request({ method: 'POST', body: { code: 'X'.repeat(SHARE_CODE_LIMITS.codeLength + 1) } })).status, 413);
  assert.equal((await app.request({ method: 'POST', body: { code }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.request({ method: 'DELETE' })).status, 405);
  assert.equal((await app.request({ method: 'PUT', body: { code } })).status, 405);
  assert.deepEqual((await app.request()).body.templates, []);
  assert.equal({}.polluted, undefined);
});

test('fresh checksums do not bypass the data-only sharing schema at the HTTP boundary', async t => {
  const app = await fixture(t);
  const code = await encodeShareCode(createProject());
  const payload = JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString('utf8'));
  for (const key of ['script', 'url', 'svg', 'filePath', '__proto__', 'constructor', 'prototype']) {
    const changed = structuredClone(payload);
    Object.defineProperty(changed, key, { value: 'javascript:alert(1)', enumerable: true });
    const result = await app.request({ method: 'POST', body: { code: signed(changed) } });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Unsupported field/);
  }
  assert.deepEqual((await app.request()).body.templates, []);
});

test('custom template text stays literal when persisted and retrieved', async t => {
  const app = await fixture(t);
  const project = createProject();
  const text = '<script>globalThis.__templateExecuted=true</script>';
  project.elements.push({ ...createElement('text'), text });
  globalThis.__templateExecuted = false;
  const code = await encodeShareCode(project);
  assert.equal((await app.request({ method: 'POST', body: { code } })).status, 201);
  const saved = (await app.request()).body.templates[0];
  assert.equal((await inspectShareCode(saved.code)).project.elements.at(-1).text, text);
  assert.equal(globalThis.__templateExecuted, false);
  delete globalThis.__templateExecuted;
});

test('template capacity is enforced inside serialized mutations and allows existing hashes', async t => {
  const root = await directory(t);
  const store = await createTemplateStore(root, { maxTemplates: 2 });
  const codes = await Promise.all(['One', 'Two', 'Three'].map(name => encodeShareCode({ ...createProject(), name })));
  const results = await Promise.allSettled(codes.map(code => store.add(code)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.match(rejected.reason.message, /full/);
  assert.equal((await store.add(codes[0])).created, false);
  const returned = store.list();
  returned[0].name = 'Changed external copy';
  assert.equal(store.list().some(template => template.name === 'Changed external copy'), false);
  await store.close();
  assert.equal((await createTemplateStore(root, { maxTemplates: 2 })).list().length, 2);
});

test('failed atomic saves leave in-memory templates untouched and the queue can recover', async t => {
  const root = await directory(t);
  const store = await createTemplateStore(root);
  const target = path.join(root, 'templates.json');
  await mkdir(target);
  const code = await encodeShareCode(createProject());
  await assert.rejects(store.add(code));
  assert.deepEqual(store.list(), []);
  assert.deepEqual(await readdir(root), ['templates.json']);
  await rm(target, { recursive: true });
  assert.equal((await store.add(code)).created, true);
  assert.equal(store.list().length, 1);
});

test('corrupted template stores fail startup without rewriting any saved bytes', async t => {
  const root = await directory(t);
  const dataDir = path.join(root, 'data');
  const webDir = path.join(root, 'web');
  await mkdir(dataDir);
  await mkdir(webDir);
  const file = path.join(dataDir, 'templates.json');
  const code = await encodeShareCode(createProject());
  const details = await inspectShareCode(code);
  const valid = {
    hash: details.hash, name: details.name, device: details.device,
    elementCount: details.elementCount, code, createdAt: new Date().toISOString(),
  };
  const corrupt = [
    '{invalid JSON',
    JSON.stringify({ version: 2, templates: [] }),
    JSON.stringify({ version: 1, templates: [], script: true }),
    JSON.stringify({ version: 1, templates: [{ ...valid, code: `${code}changed` }] }),
    JSON.stringify({ version: 1, templates: [{ ...valid, hash: '0'.repeat(64) }] }),
    JSON.stringify({ version: 1, templates: [{ ...valid, name: 'Forged metadata' }] }),
    JSON.stringify({ version: 1, templates: [{ ...valid, createdAt: 'invalid' }] }),
    JSON.stringify({ version: 1, templates: [{ ...valid, source: 'code' }] }),
    JSON.stringify({ version: 1, templates: [valid, valid] }),
    JSON.stringify({ version: 1, templates: Array(501).fill(valid) }),
  ];
  for (const content of corrupt) {
    await writeFile(file, content);
    await assert.rejects(startServer({ port: 0, dataDir, webDir }), /Cannot read saved templates/);
    assert.equal(await readFile(file, 'utf8'), content);
  }
});
