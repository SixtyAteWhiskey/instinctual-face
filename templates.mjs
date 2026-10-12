import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, open, rename, unlink } from 'node:fs/promises';
import { inspectShareCode, SHARE_CODE_LIMITS } from './web/sharing.js';

export const TEMPLATE_LIMIT = 500;
const MAX_STORE_BYTES = TEMPLATE_LIMIT * (SHARE_CODE_LIMITS.codeLength + 2048);
const fields = ['hash', 'name', 'device', 'elementCount', 'code', 'createdAt'];

class TemplateError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.status = status;
  }
}

function exactFields(value, allowed, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be an object.`);
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) {
    throw new Error(`${location} contains missing or unsupported fields.`);
  }
}

async function inspectCode(code) {
  if (typeof code !== 'string') throw new TemplateError(400, 'Template code must be a string.');
  if (code.length > SHARE_CODE_LIMITS.codeLength) throw new TemplateError(413, 'Template code exceeds the 64 KiB sharing limit.');
  try {
    const details = await inspectShareCode(code);
    return { details, code: code.trim() };
  } catch (error) {
    throw new TemplateError(400, error.message, { cause: error });
  }
}

async function readTemplate(entry) {
  exactFields(entry, fields, 'Saved template');
  const { details, code } = await inspectCode(entry.code);
  if (entry.hash !== details.hash || entry.name !== details.name || entry.device !== details.device ||
      entry.elementCount !== details.elementCount || entry.code !== code) {
    throw new Error('Saved template metadata does not match its validated share code.');
  }
  if (typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
      new Date(entry.createdAt).toISOString() !== entry.createdAt) {
    throw new Error('Saved template createdAt must be an ISO date.');
  }
  return Object.freeze(Object.fromEntries(fields.map(key => [key, entry[key]])));
}

async function writeTemplates(file, templates) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ version: 1, templates: [...templates.values()] }, null, 2));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

/** Load and validate the whole library before accepting mutations. */
export async function createTemplateStore(dataDir, { maxTemplates = TEMPLATE_LIMIT } = {}) {
  if (!Number.isInteger(maxTemplates) || maxTemplates < 1 || maxTemplates > TEMPLATE_LIMIT) {
    throw new Error(`The template limit must be an integer from 1 to ${TEMPLATE_LIMIT}.`);
  }
  await mkdir(dataDir, { recursive: true });
  const file = path.join(path.resolve(dataDir), 'templates.json');
  let templates = new Map();
  try {
    if ((await stat(file)).size > MAX_STORE_BYTES) throw new Error('The saved template library is too large.');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    exactFields(stored, ['version', 'templates'], 'Template store');
    if (stored.version !== 1 || !Array.isArray(stored.templates) || stored.templates.length > maxTemplates) {
      throw new Error(`Invalid template store version or template count (maximum ${maxTemplates}).`);
    }
    for (const input of stored.templates) {
      const template = await readTemplate(input);
      if (templates.has(template.hash)) throw new Error('Duplicate saved template hash.');
      templates.set(template.hash, template);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read saved templates at ${file}: ${error.message}`, { cause: error });
  }

  let writeQueue = Promise.resolve();
  return {
    list() {
      return [...templates.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.hash.localeCompare(b.hash))
        .map(template => ({ ...template }));
    },
    async add(code) {
      const inspected = await inspectCode(code);
      const pending = writeQueue.then(async () => {
        const existing = templates.get(inspected.details.hash);
        if (existing) {
          if (existing.code !== inspected.code) throw new TemplateError(409, 'This checksum already identifies different template data.');
          return { template: { ...existing }, created: false };
        }
        if (templates.size >= maxTemplates) throw new TemplateError(409, `The template library is full (${maxTemplates} templates).`);
        const template = Object.freeze({
          hash: inspected.details.hash, name: inspected.details.name, device: inspected.details.device,
          elementCount: inspected.details.elementCount, code: inspected.code, createdAt: new Date().toISOString(),
        });
        const updated = new Map(templates);
        updated.set(template.hash, template);
        await writeTemplates(file, updated);
        templates = updated;
        return { template: { ...template }, created: true };
      });
      writeQueue = pending.catch(() => {});
      return pending;
    },
    async close() { await writeQueue; },
  };
}
