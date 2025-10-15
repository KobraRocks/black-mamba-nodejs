import '../../env/index.js';
import { open } from '../../sqlite/index.mjs';

export function SQLiteStore(dbPath = process.env.BM_SESSION_DB || process.env.BM_DATABASE || 'sessions.db') {
  let dbPromise = null;

  async function db() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const d = await open(dbPath);
        await d.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            device_id TEXT,
            user_status TEXT,
            data TEXT NOT NULL,
            exp INTEGER NOT NULL,
            tmp TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')),
            last_access INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);
          CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
        `);
        try {
          await d.exec('ALTER TABLE sessions ADD COLUMN user_status TEXT');
        } catch {}
        return d;
      })();
    }
    return dbPromise;
  }

  return {
    async get(id) {
      const d = await db();
      const row = await d.get('SELECT data, exp, tmp, user_id, device_id, user_status FROM sessions WHERE id=?', [id]);
      if (!row) return null;
      return {
        data: safeJSON(row.data) || {},
        exp: Number(row.exp) || null,
        tmp: safeJSON(row.tmp) || {},
        user_id: row.user_id || null,
        device_id: row.device_id || null,
        user_status: row.user_status || null
      };
    },
    async set(id, record) {
      const d = await db();
      const data = JSON.stringify(record.data || {});
      const tmp = JSON.stringify(record.tmp || {});
      const exp = Number(record.exp) || 0;
      const user_id = record.user_id ?? null;
      const device_id = record.device_id ?? null;
      const user_status = record.user_status ?? null;
      await d.run(
        `INSERT INTO sessions(id, user_id, device_id, user_status, data, exp, tmp, updated_at, last_access)
         VALUES(?,?,?,?,?,?,?, strftime('%s','now'), strftime('%s','now'))
         ON CONFLICT(id) DO UPDATE SET
           user_id=excluded.user_id,
           device_id=excluded.device_id,
           user_status=excluded.user_status,
           data=excluded.data,
           exp=excluded.exp,
           tmp=excluded.tmp,
           updated_at=strftime('%s','now'),
           last_access=strftime('%s','now')`,
        [id, user_id, device_id, user_status, data, exp, tmp]
      );
    },
    async destroy(id) {
      const d = await db();
      await d.run('DELETE FROM sessions WHERE id=?', [id]);
    },
    async touch(id, newExp) {
      const d = await db();
      await d.run('UPDATE sessions SET exp=?, last_access=strftime(\'%s\',\'now\') WHERE id=?', [Number(newExp) || 0, id]);
    }
  };
}

function safeJSON(s) {
  if (!s) return null;
  try { return JSON.parse(String(s)); } catch { return null; }
}
