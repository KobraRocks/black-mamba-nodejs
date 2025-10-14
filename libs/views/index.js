import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function appRoot() {
  // libs/views/index.js -> app root is two levels up
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

function singularize(name) {
  if (!name) return '';
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

function existingFile(p) {
  try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

export function resolveViewPaths(controller, action) {
  const root = appRoot();
  const ns = (controller?.namespace || '').toString().trim();
  const resources = (controller?.resources || '').toString().trim();
  const singular = (controller?.resource || '').toString().trim() || singularize(resources);

  const candidates = [];
  if (ns) {
    if (resources) candidates.push(path.join(root, 'views', ns, resources, `${action}.js`));
    if (singular) candidates.push(path.join(root, 'views', ns, singular, `${action}.js`));
  }
  if (resources) candidates.push(path.join(root, 'views', resources, `${action}.js`));
  if (singular) candidates.push(path.join(root, 'views', singular, `${action}.js`));
  return candidates;
}

export function findView(controller, action) {
  const candidates = resolveViewPaths(controller, action);
  for (const p of candidates) {
    const f = existingFile(p);
    if (f) return f;
  }
  return null;
}

async function loadView(filePath) {
  const mod = await import(pathToFileURL(filePath).href);
  const fn = (typeof mod?.default === 'function') ? mod.default : (typeof mod?.render === 'function' ? mod.render : null);
  if (!fn) throw new Error(`View missing export function: ${filePath}`);
  return fn;
}

export async function renderView(controller, action, request, response, assigns) {
  const p = findView(controller, action);
  if (!p) return null;
  const fn = await loadView(p);
  const ctx = {
    controller,
    action,
    request,
    response,
    params: request?.params || {},
    assigns: assigns === undefined ? null : assigns
  };
  const html = await Promise.resolve(fn(ctx));
  if (typeof html !== 'string') throw new Error(`View did not return a string: ${p}`);
  return html;
}

// Renders and writes to response if a view exists. Returns Promise<boolean>.
export async function renderViewIfPresent(controller, action, request, response, assigns) {
  const html = await renderView(controller, action, request, response, assigns);
  if (html == null) return false;
  if (typeof response?.header === 'function') response.header('Content-Type', 'text/html; charset=utf-8');
  if (typeof response?.send === 'function') response.send(html);
  return true;
}

