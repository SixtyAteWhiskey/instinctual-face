/** Build and verify the Compose stack with disposable storage and loopback ports. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from '../web/model.js';
import { encodeShareCode } from '../web/sharing.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(path.join(os.tmpdir(), 'instinctual-docker-'));
const project = `instinctual-verify-${randomUUID().slice(0, 8)}`;
const image = `instinctual-face:${project}`;
const override = path.join(directory, 'compose.verify.yaml');
const docker = process.env.INSTINCTUAL_DOCKER_BIN || 'docker';
const compose = ['compose', '--project-directory', root, '-p', project, '-f', path.join(root, 'compose.yaml'), '-f', override];
const run = (args, inherit = false) => execFileSync(docker, args, { cwd: root,
  encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 4 * 1024 * 1024 });
async function request(base, route, method = 'GET', body) {
  const response = await fetch(`${base}${route}`, { method, signal: AbortSignal.timeout(15000),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
let started = false;
try {
  await writeFile(override, `services:\n  instinctual-face:\n    image: ${image}\n    restart: "no"\n    ports: !override\n      - "127.0.0.1:0:3000"\n`);
  run([...compose, 'config', '--quiet']);
  started = true;
  run([...compose, 'up', '--build', '-d', '--wait', '--wait-timeout', '120'], true);
  const container = run([...compose, 'ps', '-q', 'instinctual-face']).trim();
  const address = run([...compose, 'port', 'instinctual-face', '3000']).trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const base = `http://${address}`;
  assert.equal(run(['inspect', '--format', '{{.State.Health.Status}}', container]).trim(), 'healthy');
  assert.notEqual(run(['exec', container, 'id', '-u']).trim(), '0', 'container runs without root');
  run(['exec', container, 'java', '-version']);
  run(['exec', container, 'python3', '--version']);
  assert.equal((await request(base, '/api/health')).body.ok, true);
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await request(base, '/api/compiler')).body.desktopSetupSupported, false);
  run(['exec', container, 'node', 'scripts/verify-runtime.mjs'], true);
  const face = createProject('summit', 'instinct3solar50mm');
  face.name = 'Disposable Docker persistence check';
  const saved = await request(base, `/api/projects/${face.id}`, 'PUT', face);
  assert.equal(saved.status, 200);
  const code = await encodeShareCode(saved.body.project);
  assert.equal((await request(base, '/api/templates', 'POST', { code })).status, 201);
  run([...compose, 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120'], true);
  const secondBase = `http://${run([...compose, 'port', 'instinctual-face', '3000']).trim()}`;
  assert.deepEqual((await request(secondBase, '/api/projects')).body.projects, [saved.body.project]);
  assert.equal((await request(secondBase, '/api/templates')).body.templates[0].code, code);
  const replacement = run([...compose, 'ps', '-q', 'instinctual-face']).trim();
  run(['exec', replacement, 'node', '--input-type=module', '-e',
    "import {existsSync} from 'node:fs'; for(const p of ['/app/data/private/developer_key.der','/app/data/garmin/sdk/bin/monkeybrains.jar','/app/.git','/app/.env']) if(existsSync(p)) throw new Error('Private source artifact in image: '+p);"]);
  console.log('Docker verification passed: image build; Compose startup and health; nonroot Node/Java/Python runtime; all-profile smoke check; project/template persistence across container recreation; no bundled keys or SDK.');
} finally {
  if (started) { try { run([...compose, 'down', '--volumes', '--remove-orphans'], true); } catch (error) { console.error('Could not clean up verification stack:', error.message); process.exitCode = 1; } }
  try { run(['image', 'rm', image]); } catch {}
  await rm(directory, { recursive: true, force: true });
}
