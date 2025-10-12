import { Iterator, RecordMode } from './enums.js';
import { runSql } from './util.js';
import { SqliteError } from './errors.js';

export class Statement {
  #dbPath;
  #sql;
  #recordMode;
  #iterator;
  #throw = false;

  constructor(dbPath, sql, recordMode, iterator) {
    this.#dbPath = dbPath;
    this.#sql = sql;
    this.#recordMode = recordMode;
    this.#iterator = iterator;
    const settingGetter = () => this.#iterator;
    this.records = { get setting() { return settingGetter(); } };
  }

  returnRecordsAsArray() { this.#iterator = Iterator.ARRAY; }
  returnRecordsAsSet() { this.#iterator = Iterator.SET; }
  useThrow() { this.#throw = true; }
  useGracefulFail() { this.#throw = false; }

  execute(_params) {
    try {
      const res = runSql(this.#dbPath, this.#sql, { json: true });
      if (!res.ok) throw res.error || new SqliteError('sqlite3 failed');
      const rows = Array.isArray(res.rows) ? res.rows : [];
      if (this.#recordMode === RecordMode.FIRST) {
        return { record: rows[0] };
      }
      if (this.#iterator === Iterator.ARRAY) return { records: rows };
      const set = new Set(rows);
      return { records: set };
    } catch (error) {
      if (this.#throw) throw error;
      return this.#recordMode === RecordMode.FIRST ? { record: undefined, error } : { records: undefined, error };
    }
  }
}

