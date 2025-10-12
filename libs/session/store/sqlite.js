import { open } from '../../sqlite/index.mjs';

export function SQLiteStore(dbPath = process.env.BM_SESSION_DB || 'sessions.db') {
  let dbPromise = null;

  async function db() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const d = await open(dbPath);
        await d.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            exp INTEGER NOT NULL,
            tmp TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);
        `);
        return d;
      })();
    }
    return dbPromise;
  }

  return {
    async get(id) {
      const d = await db();
      const row = await d.get('SELECT data, exp, tmp FROM sessions WHERE id=?', [id]);
      if (!row) return null;
      return {
        data: safeJSON(row.data) || {},
        exp: Number(row.exp) || null,
        tmp: safeJSON(row.tmp) || {}
      };
    },
    async set(id, record) {
      const d = await db();
      const data = JSON.stringify(record.data || {});
      const tmp = JSON.stringify(record.tmp || {});
      const exp = Number(record.exp) || 0;
      await d.run(
        'INSERT INTO sessions(id, data, exp, tmp) VALUES(?,?,?,?)\n         ON CONFLICT(id) DO UPDATE SET data=excluded.data, exp=excluded.exp, tmp=excluded.tmp',
        [id, data, exp, tmp]
      );
    },
    async destroy(id) {
      const d = await db();
      await d.run('DELETE FROM sessions WHERE id=?', [id]);
    },
    async touch(id, newExp) {
      const d = await db();
      await d.run('UPDATE sessions SET exp=? WHERE id=?', [Number(newExp) || 0, id]);
    }
  };
}

function safeJSON(s) {
  if (!s) return null;
  try { return JSON.parse(String(s)); } catch { return null; }
}
