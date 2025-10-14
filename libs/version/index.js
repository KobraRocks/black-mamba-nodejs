import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function rootPath(...parts) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', ...parts);
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function readPackageJsonVersion() {
  const pkgPath = rootPath('package.json');
  const raw = readText(pkgPath);
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw);
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function readVersion() {
  // Source of truth is VERSION file, fallback to package.json
  const v = (readText(rootPath('VERSION')) || '').trim();
  if (v) return v;
  const pkgV = readPackageJsonVersion();
  return pkgV || '0.0.0';
}

export function setVersion(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(v)) {
    throw new Error('Invalid version string');
  }
  // Update VERSION file
  writeText(rootPath('VERSION'), v + '\n');
  // Update package.json to keep in sync
  const pkgPath = rootPath('package.json');
  const raw = readText(pkgPath);
  if (!raw) return v;
  try {
    const pkg = JSON.parse(raw);
    pkg.version = v;
    writeText(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  } catch {
    // Ignore package.json parse errors; VERSION remains authoritative
  }
  return v;
}

export const version = readVersion();

export function bump(kind = 'patch') {
  const cur = readVersion();
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) throw new Error('Cannot bump non-semver version');
  let [_, maj, min, pat, rest] = m;
  rest = rest || '';
  let v;
  switch (kind) {
    case 'major': v = `${Number(maj) + 1}.0.0`; break;
    case 'minor': v = `${maj}.${Number(min) + 1}.0`; break;
    case 'patch': v = `${maj}.${min}.${Number(pat) + 1}`; break;
    default:
      throw new Error('Unknown bump kind: ' + kind);
  }
  return setVersion(v);
}

