import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { version, readVersion, setVersion, bump } from './index.js';

function rootPath(...parts) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', ...parts);
}

const VERSION_PATH = rootPath('VERSION');
const PKG_PATH = rootPath('package.json');

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

test('version matches VERSION file and package.json', () => {
  const fileV = fs.readFileSync(VERSION_PATH, 'utf8').trim();
  const pkgV = readJSON(PKG_PATH).version;
  assert.equal(version, fileV);
  assert.equal(readVersion(), fileV);
  assert.equal(fileV, pkgV);
});

test('setVersion writes VERSION and package.json', () => {
  const original = fs.readFileSync(VERSION_PATH, 'utf8').trim();
  const next = original.endsWith('.0') ? original.replace(/\.0$/, '.1') : original + '.1';
  try {
    setVersion(next);
    const fileV = fs.readFileSync(VERSION_PATH, 'utf8').trim();
    const pkgV = readJSON(PKG_PATH).version;
    assert.equal(fileV, next);
    assert.equal(pkgV, next);
  } finally {
    // restore
    setVersion(original);
  }
});

test('bump increases semantic version', () => {
  const original = fs.readFileSync(VERSION_PATH, 'utf8').trim();
  try {
    const [maj, min, pat] = original.split('.').map(n => Number(n));
    const p = bump('patch');
    assert.equal(p, `${maj}.${min}.${pat + 1}`);
    const m = bump('minor');
    assert.equal(m, `${maj}.${min + 1}.0`);
    const M = bump('major');
    assert.equal(M, `${maj + 1}.0.0`);
  } finally {
    setVersion(original);
  }
});

