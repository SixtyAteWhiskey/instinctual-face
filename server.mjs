import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, open, rename, unlink, stat } from 'node:fs/promises';
import { createTemplateStore } from './templates.mjs';
import { DEVICES, isDeviceColor } from './web/devices.js';
import { ELEMENT_TYPE_IDS, ELEMENT_DEFINITIONS, isGraphicElement, PROGRESS_SOURCES, ICON_NAMES } from './web/elements.js';
import { validateDesignData } from './web/sharing.js';
import { normalizeUnits } from './web/units.js';
import { createCompiler, CompilerError } from './compiler.mjs';

const BODY_LIMIT = 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const TYPES = new Set(ELEMENT_TYPE_IDS);
const FORMATS = new Set(['12h', '24h', 'short', 'long']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assert(condition, message) {
  if (!condition) throw new HttpError(400, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function number(value, min, max, field) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `${field} must be a number between ${min} and ${max}.`);
  return value;
}

function boolean(value, field) {
  assert(typeof value === 'boolean', `${field} must be true or false.`);
  return value;
}

/** Validate and copy only supported fields, keeping persisted JSON predictable. */
export function validateProject(input, expectedId = input?.id) {
  assert(isObject(input), 'A project must be a JSON object.');
  assert(typeof input.id === 'string' && ID_PATTERN.test(input.id),
    'Project id must contain 1–80 letters, numbers, underscores, or hyphens.');
  assert(input.id === expectedId, 'Project id must match the id in the URL.');
  assert(input.version === 1, 'Project version must be 1.');
  assert(typeof input.name === 'string' && input.name.trim().length >= 1 && input.name.trim().length <= 80,
    'Project name must contain 1–80 characters.');
  assert(Object.hasOwn(DEVICES, input.device), 'Choose a supported Connect IQ Instinct model.');
  const bounds = DEVICES[input.device];
  assert(isDeviceColor(input.background, bounds), 'Background must use a supported #RRGGBB display color.');
  assert(Array.isArray(input.elements) && input.elements.length <= 100,
    'Elements must be an array with at most 100 items.');
  const ids = new Set();
  const elements = input.elements.map((item, index) => {
    const field = `elements[${index}]`;
    assert(isObject(item), `${field} must be an object.`);
    assert(typeof item.id === 'string' && ID_PATTERN.test(item.id), `${field}.id must be a valid id.`);
    assert(!ids.has(item.id), `${field}.id must be unique within the project.`);
    ids.add(item.id);
    assert(TYPES.has(item.type), `${field}.type is not supported.`);
    assert(['left', 'center', 'right'].includes(item.align), `${field}.align must be left, center, or right.`);
    assert(isDeviceColor(item.color, bounds), `${field}.color must use a supported #RRGGBB display color.`);
    const element = {
      id: item.id, type: item.type,
      x: number(item.x, 0, bounds.width, `${field}.x`),
      y: number(item.y, 0, bounds.height, `${field}.y`),
      width: number(item.width, 1, bounds.width, `${field}.width`),
      height: number(item.height, 1, bounds.height, `${field}.height`),
      fontSize: number(item.fontSize, 4, bounds.fontMax, `${field}.fontSize`),
      align: item.align, color: item.color.toLowerCase(),
      label: boolean(item.label, `${field}.label`),
      visible: boolean(item.visible, `${field}.visible`),
    };
    assert(element.x + element.width <= bounds.width + 0.01 && element.y + element.height <= bounds.height + 0.01,
      `${field} extends outside the watch display.`);
    if (item.text !== undefined) {
      assert(typeof item.text === 'string' && item.text.length <= 120, `${field}.text must contain at most 120 characters.`);
      element.text = item.text;
    }
    if (item.format !== undefined) {
      assert(FORMATS.has(item.format), `${field}.format must be 12h, 24h, short, or long.`);
      assert(item.type === 'time' || item.type === 'date', `${field}.format is only supported for clocks and dates.`);
      assert(item.type === 'time' ? ['12h', '24h'].includes(item.format) : ['short', 'long'].includes(item.format),
        `${field}.format must match the element type.`);
      element.format = item.format;
    }
    if (item.locked !== undefined) element.locked = boolean(item.locked, `${field}.locked`);
    const captionKeys = ['labelText', 'labelFontSize', 'labelColor', 'labelAlign', 'labelGap'];
    assert(!isGraphicElement(item.type) || captionKeys.every(key => item[key] === undefined), `${field} graphic elements do not support captions.`);
    if (item.labelText !== undefined) {
      assert(typeof item.labelText === 'string' && item.labelText.length <= 32, `${field}.labelText must contain at most 32 characters.`);
      element.labelText = item.labelText.replace(/[\u0000-\u001f\u007f\ufffe\uffff]/g, '').trim();
    }
    if (item.labelFontSize !== undefined) element.labelFontSize = number(item.labelFontSize, 5, bounds.fontMax, `${field}.labelFontSize`);
    if (item.labelColor !== undefined) {
      assert(isDeviceColor(item.labelColor, bounds), `${field}.labelColor must use a supported #RRGGBB display color.`);
      element.labelColor = item.labelColor.toLowerCase();
    }
    if (item.labelAlign !== undefined) {
      assert(['left', 'center', 'right'].includes(item.labelAlign), `${field}.labelAlign must be left, center, or right.`);
      element.labelAlign = item.labelAlign;
    }
    if (item.labelGap !== undefined) {
      assert(Number.isInteger(item.labelGap), `${field}.labelGap must be an integer.`);
      element.labelGap = number(item.labelGap, 0, 32, `${field}.labelGap`);
    }
    const defaults = ELEMENT_DEFINITIONS[item.type].defaults;
    if (item.type === 'rectangle') {
      element.filled = item.filled === undefined ? defaults.filled : boolean(item.filled, `${field}.filled`);
      element.strokeWidth = number(item.strokeWidth === undefined ? defaults.strokeWidth : item.strokeWidth, 1, 24, `${field}.strokeWidth`);
      element.cornerRadius = number(item.cornerRadius === undefined ? defaults.cornerRadius : item.cornerRadius, 0, 100, `${field}.cornerRadius`);
    }
    if (item.type === 'progressBar' || item.type === 'progressRing') {
      const source = item.source === undefined ? defaults.source : item.source;
      assert(PROGRESS_SOURCES.includes(source), `${field}.source must use a supported progress source.`);
      element.source = source;
      element.goal = number(item.goal === undefined ? defaults.goal : item.goal, 0, 1000000, `${field}.goal`);
      element.strokeWidth = number(item.strokeWidth === undefined ? defaults.strokeWidth : item.strokeWidth, 1, 24, `${field}.strokeWidth`);
    }
    if (item.type === 'icon') {
      const icon = item.icon === undefined ? defaults.icon : item.icon;
      assert(ICON_NAMES.includes(icon), `${field}.icon must use a supported icon.`);
      element.icon = icon;
    }
    return element;
  });
  assert(isObject(input.settings), 'Project settings must be an object.');
  let units;
  if (Object.hasOwn(input.settings, 'units')) {
    const descriptor = Object.getOwnPropertyDescriptor(input.settings, 'units');
    assert(!descriptor.get && !descriptor.set && descriptor.enumerable && descriptor.value !== undefined, 'Units must contain ordinary data fields.');
    try { units = normalizeUnits(descriptor.value); }
    catch (error) { throw new HttpError(400, error.message); }
  }
  const project = {
    version: 1, id: input.id, name: input.name.trim(), device: input.device,
    background: input.background.toLowerCase(), elements,
    settings: {
      grid: boolean(input.settings.grid, 'settings.grid'),
      snap: boolean(input.settings.snap, 'settings.snap'),
      safetyMargin: input.settings.safetyMargin === undefined ? true : boolean(input.settings.safetyMargin, 'settings.safetyMargin'),
      zoom: number(input.settings.zoom, 0.5, 1.5, 'settings.zoom'),
      ...(units === undefined ? {} : { units }),
    },
  };
  if (input.modifiedAt !== undefined) {
    assert(typeof input.modifiedAt === 'string' && Number.isFinite(Date.parse(input.modifiedAt)),
      'modifiedAt must be a valid date string.');
    project.modifiedAt = new Date(input.modifiedAt).toISOString();
  }
  return project;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) {
      request.resume();
      reject(new HttpError(415, 'Send the project with Content-Type: application/json.'));
      return;
    }
    let bytes = 0;
    let chunks = [];
    let exceeded = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) {
        if (!exceeded) reject(new HttpError(413, 'Project JSON exceeds the 1 MiB request limit.'));
        exceeded = true;
        chunks = [];
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Request body must contain valid JSON.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'Request body was interrupted.')));
  });
}

async function writeProjects(file, projects) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ version: 1, projects: [...projects.values()] }, null, 2));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function decodedPath(requestUrl) {
  const rawPath = requestUrl.split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch { throw new HttpError(400, 'The request URL contains invalid encoding.'); }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') ||
      decoded.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new HttpError(400, 'Invalid request path.');
  }
  return decoded;
}

/** Reject LAN callers, proxy forwarding, CSRF and DNS rebinding before desktop actions. */
export function isLocalDesktopRequest(request, { requireOrigin = false } = {}) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return false;
  if (Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'via' || name === 'x-real-ip')) return false;
  if (typeof request.headers.host !== 'string') return false;
  const port = request.socket.localPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const authorities = ['localhost', '127.0.0.1', '[::1]'].flatMap(host => port === 80 ? [host, `${host}:80`] : [`${host}:${port}`]);
  if (!authorities.includes(request.headers.host.toLowerCase())) return false;
  let host;
  try { host = new URL(`http://${request.headers.host}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash || Number(host.port || 80) !== request.socket.localPort) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  if (requireOrigin && (request.headers.origin !== host.origin || fetchSite && fetchSite !== 'same-origin')) return false;
  return true;
}

function desktopStatus(status, request) {
  const local = isLocalDesktopRequest(request);
  return { ...status, desktopSetupSupported: Boolean(status.desktopSetupSupported && local),
    desktopSetupReason: !local && status.desktopSetupSupported ? 'Desktop setup can only be opened from a browser on this computer using localhost. A remote browser cannot open its own desktop applications through this server.' : status.desktopSetupReason };
}

/** Start the application; port 0 is useful for integration tests. */
export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  host = '0.0.0.0',
  dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data'),
  webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web'),
  compiler: providedCompiler,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  await mkdir(dataDir, { recursive: true });
  const dataFile = path.join(path.resolve(dataDir), 'projects.json');
  const webRoot = await realpath(webDir);
  const compiler = providedCompiler ?? createCompiler({ dataDir });
  let projects = new Map();
  try {
    const stored = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!isObject(stored) || stored.version !== 1 || !Array.isArray(stored.projects)) throw new Error('Invalid project store format.');
    for (const input of stored.projects) {
      const project = validateProject(input);
      if (projects.has(project.id)) throw new Error(`Duplicate stored project id: ${project.id}`);
      projects.set(project.id, project);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read saved projects at ${dataFile}: ${error.message}`, { cause: error });
  }

  let writeQueue = Promise.resolve();
  const mutate = operation => {
    const pending = writeQueue.then(async () => {
      const updated = new Map(projects);
      const result = operation(updated);
      if (updated.size !== projects.size || [...updated].some(([id, project]) => projects.get(id) !== project)) {
        await writeProjects(dataFile, updated);
      }
      projects = updated;
      return result;
    });
    writeQueue = pending.catch(() => {});
    return pending;
  };

  const templateStore = await createTemplateStore(dataDir);
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodedPath(request.url);
      if (pathname === '/api/health') {
        if (request.method !== 'GET') throw new HttpError(405, 'This endpoint accepts GET requests.');
        sendJson(response, 200, { ok: true, name: 'Instinctual Face', version: 1 });
        return;
      }
      if (pathname === '/api/compiler') {
        if (request.method !== 'GET') throw new HttpError(405, 'This endpoint accepts GET requests.');
        sendJson(response, 200, desktopStatus(await compiler.status(), request));
        return;
      }
      if (pathname === '/api/compiler/desktop-setup' || pathname === '/api/compiler/open-manager') {
        if (request.method !== 'POST') throw new HttpError(405, 'This endpoint accepts POST requests.');
        if (!isLocalDesktopRequest(request, { requireOrigin: true })) throw new HttpError(403, 'Desktop setup requires a same-origin browser on this computer using localhost, without proxy forwarding.');
        const input = await readJson(request);
        if (pathname.endsWith('/desktop-setup')) {
          assert(isObject(input) && Object.keys(input).length === 1 && input.acceptedLicense === true,
            'Read and accept the Garmin SDK license before setting up desktop tools.');
          sendJson(response, 200, desktopStatus(await compiler.setupDesktop({ acceptedLicense: true }), request));
        } else {
          assert(isObject(input) && Object.keys(input).length === 0, 'Opening SDK Manager accepts an empty JSON object.');
          sendJson(response, 200, desktopStatus(await compiler.openSdkManager(), request));
        }
        return;
      }
      if (pathname === '/api/compiler/setup') {
        if (request.method !== 'POST') throw new HttpError(405, 'This endpoint accepts POST requests.');
        const input = await readJson(request);
        assert(isObject(input) && Object.keys(input).length === 1 && input.acceptedLicense === true,
          'Read and accept the Garmin SDK license before installing.');
        sendJson(response, 200, desktopStatus(await compiler.setup({ acceptedLicense: true }), request));
        return;
      }
      if (pathname === '/api/compiler/refresh') {
        if (request.method !== 'POST') throw new HttpError(405, 'This endpoint accepts POST requests.');
        const input = await readJson(request);
        assert(isObject(input) && Object.keys(input).length === 0, 'Profile refresh accepts an empty JSON object.');
        sendJson(response, 200, desktopStatus(await compiler.refreshProfiles(), request));
        return;
      }
      if (pathname === '/api/build') {
        if (request.method !== 'POST') throw new HttpError(405, 'This endpoint accepts POST requests.');
        const input = await readJson(request);
        // The same strict data-only schema protects both imports and compiler input.
        try { validateDesignData(input); } catch (error) { throw new HttpError(400, error.message); }
        const project = validateProject(input);
        const result = await compiler.build(project);
        const safeName = result.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream', 'Content-Length': result.bytes.length,
          'Content-Disposition': `attachment; filename="${safeName}"`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        });
        response.end(result.bytes);
        return;
      }
      if (pathname === '/api/templates') {
        if (request.method === 'GET') {
          sendJson(response, 200, { templates: templateStore.list() });
        } else if (request.method === 'POST') {
          const input = await readJson(request);
          assert(isObject(input) && Object.keys(input).length === 1 && Object.hasOwn(input, 'code'),
            'Send exactly one field: { code: "IF1..." }.');
          let result;
          try { result = await templateStore.add(input.code); }
          catch (error) {
            if ([400, 409, 413].includes(error.status)) throw new HttpError(error.status, error.message);
            throw error;
          }
          sendJson(response, result.created ? 201 : 200, result);
        } else throw new HttpError(405, 'This endpoint accepts GET and POST requests.');
        return;
      }
      if (pathname === '/api/projects') {
        if (request.method !== 'GET') throw new HttpError(405, 'This endpoint accepts GET requests.');
        const saved = [...projects.values()].sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.id.localeCompare(b.id));
        sendJson(response, 200, { projects: saved });
        return;
      }
      const projectRoute = /^\/api\/projects\/([^/]+)$/.exec(pathname);
      if (projectRoute) {
        const id = projectRoute[1];
        assert(ID_PATTERN.test(id), 'Project id in URL is invalid.');
        if (request.method === 'PUT') {
          const project = validateProject(await readJson(request), id);
          project.modifiedAt ??= new Date().toISOString();
          const saved = await mutate(updated => {
            const existing = updated.get(id);
            if (existing?.modifiedAt && Date.parse(existing.modifiedAt) > Date.parse(project.modifiedAt)) return existing;
            updated.set(id, project);
            return project;
          });
          sendJson(response, 200, { project: saved });
        } else if (request.method === 'DELETE') {
          await mutate(updated => {
            if (!updated.delete(id)) throw new HttpError(404, 'Project was not found.');
          });
          sendJson(response, 200, { ok: true });
        } else throw new HttpError(405, 'This endpoint accepts PUT and DELETE requests.');
        return;
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'API endpoint was not found.');
      if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Static files accept GET and HEAD requests.');
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      const requestedFile = path.resolve(webRoot, relativePath);
      if (!requestedFile.startsWith(`${webRoot}${path.sep}`)) throw new HttpError(400, 'Invalid request path.');
      let filename;
      try {
        filename = await realpath(requestedFile);
        if (!filename.startsWith(`${webRoot}${path.sep}`)) throw new HttpError(404, 'File was not found.');
        if (!(await stat(filename)).isFile()) throw new HttpError(404, 'File was not found.');
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new HttpError(404, 'File was not found.');
        throw error;
      }
      const body = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError) && !(error instanceof CompilerError)) console.error('Request failed:', error);
      sendJson(response, error.status ?? 500, { error: error instanceof HttpError || error instanceof CompilerError ? error.message : 'The server could not complete the request. Check its logs and data directory.', ...(error instanceof CompilerError && error.diagnostics ? {diagnostics:error.diagnostics} : {}) });
    }
  });
  server.requestTimeout = 180_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
    close: async () => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await writeQueue;
      await templateStore.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(app => {
    console.log(`Instinctual Face is ready at ${app.url}`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      app.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
    });
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
