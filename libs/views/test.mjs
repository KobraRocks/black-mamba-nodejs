import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveViewPaths, findView, renderViewIfPresent } from './index.js';

function appRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

test('resolve and find view paths (plural and singular)', () => {
  const c = { namespace: '', resources: 'users', resource: '' };
  const paths = resolveViewPaths(c, 'index');
  assert.ok(paths.some(p => p.endsWith(path.join('views', 'users', 'index.js'))));
  assert.ok(paths.some(p => p.endsWith(path.join('views', 'user', 'index.js'))));
});

test('renderViewIfPresent renders HTML and sets content-type', async () => {
  const root = appRoot();
  const dir = path.join(root, 'views', '_tmp_demo');
  const file = path.join(dir, 'index.js');
  rmrf(dir);
  writeFile(file, `export default function () { return '<h1>Hello</h1>'; }`);

  const controller = { namespace: '', resources: '_tmp_demo', resource: '' };

  let headers = {};
  const fakeRes = {
    _sent: null,
    status(code) { this._status = code; return this; },
    header(name, value) { headers[name] = value; return this; },
    send(body) { this._sent = body; return this; }
  };

  const rendered = await renderViewIfPresent(controller, 'index', { params: {} }, fakeRes, null);
  try {
    assert.equal(rendered, true);
    assert.equal(fakeRes._sent, '<h1>Hello</h1>');
    assert.match(String(headers['Content-Type'] || headers['content-type'] || ''), /text\/html/);
  } finally {
    rmrf(path.join(root, 'views', '_tmp_demo'));
  }
});

test('renderViewIfPresent passes assigns to template function', async () => {
  const root = appRoot();
  const dir = path.join(root, 'views', '_tmp_assigns');
  const file = path.join(dir, 'show.js');
  rmrf(dir);
  writeFile(file, `export default function ({ assigns }) { return '<p>' + assigns.name + '</p>'; }`);

  const controller = { namespace: '', resources: '_tmp_assigns', resource: '' };

  let body = null; let headers = {};
  const fakeRes = {
    header(n, v) { headers[n] = v; return this; },
    send(b) { body = b; return this; }
  };
  const rendered = await renderViewIfPresent(controller, 'show', { params: {} }, fakeRes, { name: 'Ada' });
  try {
    assert.equal(rendered, true);
    assert.equal(body, '<p>Ada</p>');
    assert.match(String(headers['Content-Type'] || ''), /text\/html/);
  } finally {
    rmrf(path.join(root, 'views', '_tmp_assigns'));
  }
});
