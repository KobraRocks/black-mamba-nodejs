import { spawnSync } from 'node:child_process';

export function hasSqlite3Cli() {
  const r = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

export function runSql(dbPath, sql, { json = true } = {}) {
  const args = [];
  if (json) args.push('-json');
  args.push(dbPath);
  const r = spawnSync('sqlite3', args.concat([sql]), { encoding: 'utf8' });
  if (r.error) return { ok: false, error: r.error };
  if (r.status !== 0) return { ok: false, error: new Error(r.stderr || `sqlite3 exited ${r.status}`) };
  const out = r.stdout.trim();
  if (!json) return { ok: true, out };
  try {
    const parsed = out ? JSON.parse(out) : [];
    return { ok: true, rows: parsed };
  } catch (e) {
    return { ok: false, error: e, raw: out };
  }
}
