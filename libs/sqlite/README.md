# SQLite (Node.js, ESM, Native)

High‑performance, dependency‑free SQLite for Node using a native N‑API addon and a vendored SQLite amalgamation. ESM‑only surface, small API, clear behavior, and cancellation support — designed to be easy for humans and AI agents (like CODEX) to use.

**Key Points**

- ESM only (`"type": "module"`).
- Native addon (N‑API) compiles `sqlite3.c` in‑tree (no runtime deps).
- Clean async/sync API, prepared statements, blobs, WAL helpers.
- AbortSignal‑driven cancellation (cooperative via `sqlite3_interrupt`).

**Paths**

- Import from `libs/sqlite/index.mjs` within this repo.

**Requirements**

- Node `>= 18.18`
- Build tools for `node-gyp` (Python, C/C++ compiler)

**Build**

- `npm run build` or `npm run build:release`
  - Produces `libs/sqlite/build/Release/sqlite.node`
  - `.gitignore` allows committing `build/Release/sqlite.node` (only this binary)

**Ship to Production**

- Build on a host matching production OS/arch and libc.
- Run: `npm run build:release`
- Verify: `ls build/Release/sqlite.node && ldd build/Release/sqlite.node`
- Commit: `git add build/Release/sqlite.node && git commit -m "Ship sqlite addon binary" && git push`
- Node ABI: uses N-API for cross-version stability; still match distro libc (glibc vs musl).

**Exports**

- `open(path?: string, flags?: number): Promise<Database>`
- `openSync(path?: string, flags?: number): Database`
- `Database` class (created via `open`/`openSync`)
- `Statement` class (via `db.prepare/prepareSync`)
- `sqliteVersion: string` (native SQLite version)
- `ERRORS: { codes: Record<string, number>, names: Record<string, number> }`

**Type Mapping**

- SQLite NULL → `null`
- INTEGER → `bigint`
- REAL → `number`
- TEXT → `string`
- BLOB → `Uint8Array`

**Quick Start**

- import { open } from `./index.mjs`
- const db = await open(':memory:')
- await `db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')`
- const r = await `db.run('INSERT INTO t(v) VALUES (?)', ['x'])`
- const row = await `db.get('SELECT v FROM t WHERE id=?', [r.lastInsertRowid])`
- await `db.close()`

**Prepared Statements**

- const stmt = await `db.prepare('INSERT INTO users(name, pic) VALUES(:name, :pic)')`
- await `stmt.bind({ name: 'Ada', pic: new Uint8Array([1,2,3]) }).get()`
- await `stmt.finalize()`

**Named & Positional Params**

- Positional: `?`, `?1`
- Named: `:name`, `@name`, `$name`
- Examples:
  - `db.run('INSERT INTO u(name) VALUES (:name)', { name: 'alice' })`
  - `db.get('SELECT * FROM u WHERE id = ?', [1])`

**Transactions**

- Async (JS wrapper):
  - `await db.transaction(async () => { await db.run('INSERT ...') })`
- Sync (native or JS fallback):
  - `db.transactionSync(() => { db.execSync('INSERT ...') })`
  - Throws roll back the transaction.

**WAL & Checkpoint**

- Enable WAL: `await db.exec('PRAGMA journal_mode=WAL')`
- Checkpoint: `await db.checkpoint('PASSIVE'|'FULL'|'RESTART'|'TRUNCATE')`

**Cancellation**

- Long‑running queries can be cancelled:
  - `const ac = new AbortController()`
  - `const p = db.all('SELECT ...', null, { signal: ac.signal })`
  - `ac.abort()` to cooperatively cancel; internally calls `db.interrupt()`.

**Blobs**

- Accept/return `Uint8Array`.
- Example: `await db.run('INSERT INTO b(d) VALUES (?)', [new Uint8Array([0,1,2])])`

**Concurrency**

- Under WAL, many readers can run in parallel; writers serialize as in SQLite.
- Example:
  - Create file DB → `PRAGMA journal_mode=WAL` → fire multiple `db.run`/`db.all` concurrently.

**Errors**

- Native methods throw `Error` with message from `sqlite3_errmsg`.
- `ERRORS.codes` provides common `SQLITE_*` numeric constants you can use for comparison in custom flows that capture return codes.
- Example pattern:
  - `try { await db.run('INSERT ... UNIQUE ...') } catch (e) { /* match on e.message */ }`

**Testing**

- `node --test libs/sqlite/test/*.test.mjs`
  - Suites include concurrency, blobs, named params, cancellation, and basic flows.

**Troubleshooting**

- Build fails: ensure Python + compiler toolchain are installed and `node-gyp` works for your Node version.
- If the addon isn’t found, ensure `node-gyp rebuild` ran in `libs/sqlite` and produced `build/Release/sqlite.node`.

API Reference

- See `libs/sqlite/doc.md` for the full API surface (methods, types, and helpers).

**Handling UNIQUE/CONSTRAINT errors**

- SQLite returns constraint failures as errors; the addon throws with `sqlite3_errmsg()` content.
- Practical pattern (check message contents):
  - try {
      await db.run('INSERT INTO users(email) VALUES (?)', ['alice@example.com'])
    } catch (e) {
      if (String(e.message).includes('UNIQUE constraint failed')) {
        // Handle duplicate
      } else throw e
    }
- Alternate: use UPSERT to avoid exceptions (preferred when logic allows):
  - await db.run('INSERT INTO users(email, name) VALUES (?, ?)\n ON CONFLICT(email) DO UPDATE SET name=excluded.name', ['alice@example.com','Alice'])

**Cookbook**

- Create table + index
  - await db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT);
                   CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)`)
- Upsert (ON CONFLICT)
  - await db.run('INSERT INTO users(email, name) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET name=excluded.name', ['a@x','Alice'])
- Bulk insert with prepared statement reuse
  - const ins = await db.prepare('INSERT INTO logs(ts, msg) VALUES(?, ?)')
  - for (const line of lines) { await ins.bind([Date.now(), line]).get() }
  - await ins.finalize()
- Pagination
  - const page = 2, per = 20
  - const rows = await db.all('SELECT *FROM items ORDER BY id LIMIT ? OFFSET ?', [per, (page-1)*per])
- Named parameters
  - await db.get('SELECT * FROM users WHERE email = :email', { email: 'a@x' })
- Blobs (store and read)
  - await db.run('INSERT INTO files(name, data) VALUES(?, ?)', ['a.bin', new Uint8Array([1,2,3])])
  - const f = await db.get('SELECT data FROM files WHERE name=?', ['a.bin'])
- Transactions
  - await db.transaction(async () => {
      await db.run('UPDATE accounts SET bal=bal-? WHERE id=?', [100, 1])
      await db.run('UPDATE accounts SET bal=bal+? WHERE id=?', [100, 2])
    })
- WAL + checkpoint
  - await db.exec('PRAGMA journal_mode=WAL')
  - await db.checkpoint('PASSIVE')
- Cancellation (AbortController)
  - const ac = new AbortController()
  - const p = db.all('WITH RECURSIVE t(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM t WHERE x<1e7) SELECT x FROM t', null, { signal: ac.signal })
  - ac.abort() // cooperatively cancel
