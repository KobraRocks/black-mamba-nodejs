# SQLite ESM API Reference

This document describes the full public API exposed by `libs/sqlite/index.mjs`.

- Module style: ESM only (`type: module`)
- Build: `cd libs/sqlite && node-gyp rebuild`
- Native: N‑API addon + vendored SQLite amalgamation

## Imports

```
import {
  open, openSync,
  Database, Statement,
  sqliteVersion, libVersion, ERRORS,
  errorMessage, isConstraintError, isBusyError, isLockedError,
} from './libs/sqlite/index.mjs'
```

## Types

- `Params`:
  - Positional: `readonly unknown[]` (e.g., `[1, 'Ada']`)
  - Named: `Record<string, unknown>` with markers `:name`, `@name`, `$name`
- `Row`: `Record<string, unknown>`
- `Result`: `{ changes: number, lastInsertRowid: bigint }`
- `ExecOptions | RunOptions`: `{ signal?: AbortSignal }`
- `PrepareOptions`: reserved (not used yet)

### SQLite → JS Mapping

- `NULL` → `null`
- `INTEGER` → `bigint`
- `REAL` → `number`
- `TEXT` → `string`
- `BLOB` → `Uint8Array`

## Top‑level Exports

### open(path?: string, flags?: number): Promise<Database>
- Opens a database file or `':memory:'`.
- Resolves to a `Database` instance.

### openSync(path?: string, flags?: number): Database
- Synchronous variant.

### sqliteVersion: string
- Native SQLite version string (e.g., "3.50.4").

### libVersion: string
- Wrapper library version string.

### ERRORS: { codes: Record<string, number>, names: Record<string, string> }
- `codes` example: `{ SQLITE_OK: 0, SQLITE_CONSTRAINT: 19, ... }`
- `names` example: `{ '19': 'SQLITE_CONSTRAINT', ... }`

### Error helpers
- `errorMessage(err): string` — best‑effort extraction of an error message
- `isConstraintError(err): boolean` — true if message contains "constraint"
- `isBusyError(err): boolean` — true if message contains "busy"
- `isLockedError(err): boolean` — true if message contains "locked"

## Class: Database

Constructed via `open`/`openSync` only.

### Properties
- `path: string` — database path or `':memory:'`
- `openFlags: number` — underlying flags (reserved)
- `isOpen: boolean` — whether handle is open

### Methods

#### exec(sql: string, options?: { signal?: AbortSignal }): Promise<void>
- Executes one or more SQL statements (no row results).
- Respects `AbortSignal` (cooperative cancel via `sqlite3_interrupt`).

#### execSync(sql: string): void
- Synchronous variant.

#### run(sql: string, params?: Params, options?: { signal?: AbortSignal }): Promise<Result>
- Executes DML (INSERT/UPDATE/DELETE). Returns `{ changes, lastInsertRowid }`.

#### runSync(sql: string, params?: Params): Result
- Synchronous variant.

#### get(sql: string, params?: Params, options?: { signal?: AbortSignal }): Promise<Row|undefined>
- Returns the first matching row (or `undefined` if none).

#### getSync(sql: string, params?: Params): Row|undefined
- Synchronous variant.

#### all(sql: string, params?: Params, options?: { signal?: AbortSignal }): Promise<Row[]>
- Returns all matching rows.
- Supports cancellation via `AbortSignal`.

#### allSync(sql: string, params?: Params): Row[]
- Synchronous variant.

#### prepare(sql: string, options?: PrepareOptions): Promise<Statement>
- Creates a prepared statement for repeated execution.

#### prepareSync(sql: string, options?: PrepareOptions): Statement
- Synchronous variant.

#### transaction<T>(fn: () => Promise<T> | T, mode?: 'deferred'|'immediate'|'exclusive'): Promise<T>
- JS wrapper that runs `fn` inside `BEGIN … COMMIT`, rolling back on error.

#### transactionSync<T>(fn: () => T, mode?: 'deferred'|'immediate'|'exclusive'): T
- Uses native `dbTxSync` when available; otherwise JS fallback.
- Rolls back on thrown errors.

#### pragma(name: string, value?: string|number|boolean): Promise<any>
- Convenience via `exec/get` (reserved; currently call raw SQL directly).

#### pragmaSync(name: string, value?: string|number|boolean): any
- Synchronous variant.

#### enableWAL(): Promise<void>
- Shorthand: `exec('PRAGMA journal_mode=WAL')`.

#### enableWALSync(): void
- Synchronous variant.

#### checkpoint(mode?: 'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'): Promise<void>
- WAL checkpointing via native call.

#### checkpointSync(mode?: 'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'): void
- Synchronous variant.

#### interrupt(): void
- Calls `sqlite3_interrupt` on the underlying handle (cooperative cancel).

#### close(): Promise<void>
- Closes the database.

#### closeSync(): void
- Synchronous close.

## Class: Statement

Created by `db.prepare` / `db.prepareSync`.

### Properties
- `sql: string` — original SQL.

### Methods

#### bind(params?: Params): this
- Binds positional or named parameters. Returns `this` for chaining.

#### step(options?: { signal?: AbortSignal }): Promise<boolean>
- Advances one row; resolves `true` if a row is available, otherwise `false`.

#### stepSync(): boolean
- Synchronous variant.

#### get(): Promise<Row|undefined>
- Convenience: bind (if previously set) + step + return first row.

#### getSync(): Row|undefined
- Synchronous variant.

#### all(limit?: number, options?: { signal?: AbortSignal }): Promise<Row[]>
- Reads all rows (optionally up to `limit`) from the statement.

#### allSync(limit?: number): Row[]
- Synchronous variant.

#### reset(): void
- Resets the statement for reuse.

#### finalize(): Promise<void>
- Destroys the native statement.

#### finalizeSync(): void
- Synchronous variant.

## Parameters

- Positional markers: `?`, `?NNN`
- Named markers: `:name`, `@name`, `$name`
- Supported JS types: `number`, `bigint`, `string`, `null`/`undefined`, `Uint8Array` (BLOB)

## Cancellation

Operations that return a `Promise` accept `{ signal?: AbortSignal }`. When aborted, the DB connection is interrupted via `db.interrupt()`. The operation rejects promptly (best‑effort; SQLite cancellation is cooperative).

## Errors

- Native methods throw `Error` from `sqlite3_errmsg()`.
- Use `ERRORS.codes` for constants, or helper functions to match on common cases:

```
import { isConstraintError } from './libs/sqlite/index.mjs'
try {
  await db.run('INSERT INTO users(email) VALUES (?)', ['a@example.com'])
} catch (e) {
  if (isConstraintError(e)) {
    // handle duplicate
  } else {
    throw e
  }
}
```

## Examples

See `libs/sqlite/README.md` for cookbook patterns and `libs/sqlite/test/*.test.mjs` for runnable examples.

