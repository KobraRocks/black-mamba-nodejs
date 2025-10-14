import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

function projectRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnv({ override = true } = {}) {
  if (loaded) return true;
  const envPath = path.join(projectRoot(), '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const parsed = parseDotEnv(content);
    for (const [k, v] of Object.entries(parsed)) {
      if (!/^BM_[A-Z0-9_]+$/.test(k)) continue; // enforce BM_ prefix
      if (override || process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
    loaded = true;
    return true;
  } catch {
    loaded = true; // mark attempted to avoid repeated fs checks
    return false;
  }
}

// Auto-load on import with override precedence.
loadEnv({ override: true });

export function getEnv(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

