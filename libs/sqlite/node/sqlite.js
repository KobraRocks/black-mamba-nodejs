import { SqliteError } from './errors.js';
import { Iterator, RecordMode } from './enums.js';
import { Statement } from './statement.js';
import { createPragma } from './pragma.js';
import { runSql, hasSqlite3Cli } from './util.js';

export class Database {
  #dbPath;
  #iterator = Iterator.SET;

  constructor(dbPath) {
    this.#dbPath = dbPath;
    this.pragma = createPragma(dbPath);
    this.records = (() => {
      const useSet = () => { this.#iterator = Iterator.SET; };
      const useArray = () => { this.#iterator = Iterator.ARRAY; };
      const settingGetter = () => this.#iterator;
      return { useSet, useArray, get setting() { return settingGetter(); } };
    })();
  }

  #exec(sql) {
    const r = runSql(this.#dbPath, sql, { json: false });
    if (!r.ok) throw r.error || new SqliteError('sqlite exec failed');
  }

  prepare_match_first(sql) { return new Statement(this.#dbPath, sql, RecordMode.FIRST, this.#iterator); }
  prepare_match_all(sql) { return new Statement(this.#dbPath, sql, RecordMode.ALL, this.#iterator); }

  prepare_insert(sql) {
    const normalized = sql.toUpperCase();
    if (!normalized.includes('INSERT') || !normalized.includes('RETURNING *')) {
      throw new SqliteError('prepare_insert expects `INSERT` and `RETURNING *`');
    }
    return new Statement(this.#dbPath, sql, RecordMode.FIRST, this.#iterator);
  }
  prepare_update(sql) {
    const normalized = sql.toUpperCase();
    if (!normalized.includes('UPDATE') || !normalized.includes('RETURNING *')) {
      throw new SqliteError('prepare_update expects `UPDATE` and `RETURNING *`');
    }
    return new Statement(this.#dbPath, sql, RecordMode.FIRST, this.#iterator);
  }
  prepare_delete(sql) {
    const normalized = sql.toUpperCase();
    if (!normalized.includes('DELETE') || !normalized.includes('RETURNING *')) {
      throw new SqliteError('prepare_delete expects `DELETE` and `RETURNING *`');
    }
    return new Statement(this.#dbPath, sql, RecordMode.FIRST, this.#iterator);
  }

  execute(sql) {
    try { this.#exec(sql); return { ok: true }; }
    catch (error) { return { ok: false, error }; }
  }

  commitOrRollback(sql) {
    try {
      this.#exec('BEGIN');
      this.#exec(sql);
      this.#exec('COMMIT');
      return { ok: true };
    } catch (error) {
      try { this.#exec('ROLLBACK'); } catch {}
      return { ok: false, error };
    }
  }
}

export function createDatabase(databasePath, options = {}) {
  if (!hasSqlite3Cli()) {
    throw new SqliteError('sqlite3 CLI not found in PATH; please install sqlite3');
  }
  // Ensure the file exists by touching via sqlite (creates if not exists)
  const res = runSql(databasePath, 'PRAGMA schema_version;', { json: false });
  if (!res.ok) throw new SqliteError('sqlite3 open failed', undefined, res.error);

  if (options.pragma) {
    const [name, value] = options.pragma;
    const pragmaSql = `PRAGMA ${name} = ${value};`;
    const r = runSql(databasePath, pragmaSql, { json: false });
    if (!r.ok) throw new SqliteError('sqlite3 pragma failed', undefined, r.error);
  }

  return new Database(databasePath);
}

export function createDatabases(configArray) {
  const databases = new Map();
  for (const { ref, path, options } of configArray) {
    databases.set(ref, createDatabase(path, options));
  }
  return databases;
}

const SQLITE = { createDatabase, createDatabases };
export default SQLITE;
