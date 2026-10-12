import { normalizeProject } from './model.js';
import { ELEMENT_DEFINITIONS } from './elements.js';

const MAX_CODE_LENGTH = 64 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_ELEMENTS = 100;
const encoder = new TextEncoder();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const projectFields = ['version', 'id', 'name', 'device', 'background', 'elements', 'settings', 'modifiedAt'];
const payloadFields = ['version', 'name', 'device', 'background', 'elements', 'settings'];
const elementFields = ['id', 'type', 'x', 'y', 'width', 'height', 'fontSize', 'align', 'color', 'label', 'locked', 'visible'];
const requiredElementFields = elementFields.filter(key => key !== 'locked');
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);

export const SHARE_CODE_LIMITS = Object.freeze({ codeLength: MAX_CODE_LENGTH, payloadBytes: MAX_PAYLOAD_BYTES, elements: MAX_ELEMENTS });

function record(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be a plain data object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${location} must be a plain data object.`);
}

function allowedKeys(value, allowed, required, location) {
  record(value, location);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || forbiddenKeys.has(key) || !allowed.includes(key)) {
      throw new Error(`Unsupported field in ${location}: ${String(key)}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error(`${location} must contain ordinary data fields.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${location} is missing ${key}.`);
  }
}

/** Share templates accept a narrower, data-only schema before model validation. */
function validateTemplate(input, payload = false) {
  allowedKeys(input, payload ? payloadFields : projectFields, payloadFields, 'Template');
  if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 80) {
    throw new Error('Template name must contain 1–80 characters.');
  }
  if (!Array.isArray(input.elements) || input.elements.length > MAX_ELEMENTS) {
    throw new Error(`A shared template may contain at most ${MAX_ELEMENTS} elements.`);
  }
  // JSON arrays cannot carry named fields, and neither may locally supplied arrays.
  for (const key of Reflect.ownKeys(input.elements)) {
    if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) {
      throw new Error('The elements array contains an unsupported field.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(input.elements, key);
    if (descriptor.get || descriptor.set) throw new Error('The elements array must contain ordinary data fields.');
  }
  for (let index = 0; index < input.elements.length; index++) {
    if (!Object.hasOwn(input.elements, index)) throw new Error('The elements array may not contain empty slots.');
    const element = input.elements[index];
    record(element, `Element ${index + 1}`);
    // Inspect the data descriptor before reading a possibly hostile accessor.
    const type = Object.getOwnPropertyDescriptor(element, 'type')?.value;
    const graphicFields = Object.keys(ELEMENT_DEFINITIONS[type]?.defaults ?? {}).filter(key => !['width', 'height', 'fontSize', 'label', 'text', 'format'].includes(key));
    allowedKeys(element, [...elementFields, 'text', 'format', 'labelText', 'labelFontSize', 'labelColor', 'labelAlign', 'labelGap', ...graphicFields], requiredElementFields, `Element ${index + 1}`);
    if (element.type !== 'text' && Object.hasOwn(element, 'text')) throw new Error(`Unsupported field in Element ${index + 1}: text.`);
    if (element.type !== 'time' && element.type !== 'date' && Object.hasOwn(element, 'format')) throw new Error(`Unsupported field in Element ${index + 1}: format.`);
    if (element.type === 'text' && (typeof element.text !== 'string' || element.text.length > 120)) {
      throw new Error('Shared custom text must be a string with at most 120 characters.');
    }
    if (Object.hasOwn(element, 'labelText') && (typeof element.labelText !== 'string' || element.labelText.length > 32)) throw new Error('Shared caption text must be a string with at most 32 characters.');
  }
  allowedKeys(input.settings, ['grid', 'snap', 'zoom', 'safetyMargin', 'units'], ['grid', 'snap', 'zoom'], 'Settings');
  return normalizeProject(input);
}

/** Strict design validation without applying portable-code byte limits. */
export function validateDesignData(input) {
  return validateTemplate(input);
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function base64url(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += alphabet[a >>> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)];
    if (index + 1 < bytes.length) output += alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)];
    if (index + 2 < bytes.length) output += alphabet[c & 63];
  }
  return output;
}

function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('The share code contains invalid base64url data.');
  const length = Math.floor(value.length * 6 / 8);
  if (length > MAX_PAYLOAD_BYTES) throw new Error('The shared template exceeds the 32 KiB payload limit.');
  const bytes = new Uint8Array(length);
  let bits = 0;
  let accumulator = 0;
  let index = 0;
  for (const character of value) {
    accumulator = (accumulator << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (accumulator >>> bits) & 255;
    }
  }
  if (base64url(bytes) !== value) throw new Error('The share code contains noncanonical base64url data.');
  return bytes;
}

// SHA-256 operates on bounded byte arrays and works on ordinary HTTP LAN origins,
// where browsers may not expose crypto.subtle. This checksum is not a signature.
const shaConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));

function sha256(bytes) {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bytes.length / 0x20000000), false);
  view.setUint32(paddedLength - 4, bytes.length * 8 >>> 0, false);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15];
      const b = words[index - 2];
      const small0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const small1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + small0 + words[index - 7] + small1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const big1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + big1 + choose + shaConstants[index] + words[index]) >>> 0;
      const big0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (big0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    const chunk = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index++) state[index] = (state[index] + chunk[index]) >>> 0;
  }
  return [...state].map(value => value.toString(16).padStart(8, '0')).join('');
}

/** Creates a portable, deterministic template code without project identity metadata. */
export async function encodeShareCode(project) {
  const clean = validateTemplate(project);
  const payload = Object.fromEntries(payloadFields.map(key => [key, clean[key]]));
  const bytes = encoder.encode(canonicalJSON(payload));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error('This template exceeds the 32 KiB sharing limit. Reduce its elements or custom text.');
  const code = `IF1.${base64url(bytes)}.${sha256(bytes)}`;
  if (code.length > MAX_CODE_LENGTH) throw new Error('This template exceeds the 64 KiB share code limit.');
  return code;
}

async function readShareCode(code) {
  if (typeof code !== 'string' || code.length === 0) throw new Error('Paste an Instinctual Face share code.');
  if (code.length > MAX_CODE_LENGTH) throw new Error('The share code exceeds the 64 KiB limit.');
  const match = /^IF1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(code.trim());
  if (!match) throw new Error('Invalid share code format. Expected IF1, base64url template data, and a SHA-256 checksum.');
  const bytes = unbase64url(match[1]);
  if (sha256(bytes) !== match[2]) throw new Error('The share code checksum does not match. Its data may be damaged or changed.');
  let text;
  let payload;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    payload = JSON.parse(text);
  } catch {
    throw new Error('The shared template must contain valid UTF-8 JSON data.');
  }
  const project = validateTemplate(payload, true);
  if (canonicalJSON(payload) !== text) throw new Error('The shared template must use canonical JSON with unique, sorted keys.');
  return { project, hash: match[2], codeLength: code.trim().length };
}

/** Validates integrity and schema, then returns a new project ready for review/import. */
export async function decodeShareCode(code) {
  return (await readShareCode(code)).project;
}

/** Supplies reviewed data and a summary without persisting or executing anything. */
export async function inspectShareCode(code) {
  const result = await readShareCode(code);
  return {
    ...result, name: result.project.name, device: result.project.device,
    elementCount: result.project.elements.length,
  };
}
