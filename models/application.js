// ApplicationRecord — Rails-style base model (ESM, no deps)
// Inspired by Rails conventions: id PK, timestamps, validations, bang methods.

import { openSync as openDatabase } from "../libs/sqlite/index.mjs";
import { pluralize as pluralizeWord } from "../libs/inflector/index.js";

// -- DB bootstrap -------------------------------------------------------------
import '../libs/env/index.js';
// Uses BM_DATABASE (or BM_SESSION_DB fallback used elsewhere in the repo)
const DB = openDatabase(process.env.BM_DATABASE || process.env.BM_SESSION_DB || ":memory:");

// Statement helper: prefer native prepared statements if available; otherwise
// provide a minimal wrapper that executes directly via DB.* methods.
function prepare(sql) {
  const canPrepare = typeof DB.prepareSync === "function";
  if (canPrepare) return DB.prepareSync(sql);
  // Fallback shim compatible with .bind(...).get/all/run patterns used below
  const stmt = {
    sql,
    bind(params = null) {
      return {
        get:     () => DB.get(sql, params),
        getSync: () => DB.getSync(sql, params),
        all:     () => DB.all(sql, params),
        allSync: () => DB.allSync(sql, params),
        run:     () => DB.run(sql, params),
        runSync: () => DB.runSync(sql, params),
      };
    },
    // No params
    get:     () => DB.get(sql),
    getSync: () => DB.getSync(sql),
    all:     () => DB.all(sql),
    allSync: () => DB.allSync(sql),
    run:     () => DB.run(sql),
    runSync: () => DB.runSync(sql),
  };
  return stmt;
}

// -- Utilities ----------------------------------------------------------------
const SQL_VENDORS = Object.freeze({ SQLITE: "sqlite" });

// Minimal Rails-like Errors container
class Errors {
  constructor() { this._errors = new Map(); }
  add(attr, message) {
    const key = String(attr);
    if (!this._errors.has(key)) this._errors.set(key, []);
    this._errors.get(key).push(String(message));
  }
  on(attr) { return this._errors.get(String(attr)) || []; }
  any() { return this._errors.size > 0; }
  isEmpty() { return this._errors.size === 0; }
  clear() { this._errors.clear(); }
  fullMessages() {
    const out = [];
    for (const [attr, msgs] of this._errors.entries()) {
      for (const m of msgs) out.push(`${attr} ${m}`);
    }
    return out;
  }
  fullMessage() { return this.fullMessages().join(", "); }
}

const isBool = v => typeof v === "boolean";
const isNil  = v => v === null || v === undefined;

const cap = (str="") => String(str).toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
const underscore = (str="") => String(str)
  .replace(/::/g, '/')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  .replace(/([a-z\d])([A-Z])/g, '$1_$2')
  .toLowerCase();

const nowIso = () => new Date().toISOString();

// Guard identifiers (very light; assumes trusted schema names)
const ident = name => name.replace(/[^a-zA-Z0-9_]/g, "");

// Build "a, b, c" and "?, ?, ?" style fragment helpers
const joinCols = cols => cols.map(ident).join(", ");
const namedParams = cols => cols.map(c => `:${ident(c)}`).join(", ");

// -- SQLite type wrappers -----------------------------------------------------
class StringProperty extends String {
  static sqlite_type = "TEXT";
  to_sqlite() { return this.toString(); }
}
class TextProperty extends String {
  static sqlite_type = "TEXT";
  to_sqlite() { return this.toString(); }
}
class IntegerProperty extends Number {
  static sqlite_type = "INTEGER";
  to_sqlite() { return Number.isFinite(+this) ? Number(this.valueOf()) : null; }
}
class FloatProperty extends Number {
  static sqlite_type = "REAL";
  to_sqlite() { return Number.isFinite(+this) ? Number(this.valueOf()) : null; }
}
class DateProperty extends Date {
  static sqlite_type = "TEXT"; // stored as ISO 8601
  to_sqlite() { return new Date(this.valueOf()).toISOString(); }
}

const TYPE_MAP = Object.freeze({
  String:  StringProperty,
  Text:    TextProperty,
  Integer: IntegerProperty,
  Float:   FloatProperty,
  Date:    DateProperty,
});

function normalizeFieldDefinition(def) {
  // Accept: ["string","mandatory"] or { type:"string", mandatory:true, default:..., reference:"table(col)"}
  if (Array.isArray(def)) {
    const [typeRaw, mandatoryRaw, defaultValue, reference] = def;
    return {
      type: cap(typeRaw),
      mandatory: mandatoryRaw === true || String(mandatoryRaw).toLowerCase() === "mandatory",
      default: defaultValue ?? null,
      reference: reference ?? "",
    };
  }
  const { type = "", mandatory = false, default: d = null, reference = "" } = def || {};
  return { type: cap(type), mandatory: !!mandatory, default: d, reference };
}

// -- Property -----------------------------------------------------------------
class Property {
  static String  = StringProperty;
  static Text    = TextProperty;
  static Integer = IntegerProperty;
  static Float   = FloatProperty;
  static Date    = DateProperty;

  #typeClass;
  #mandatory;
  #default;
  #reference;

  constructor({ type = "", mandatory = false, default: d = null, reference = "" } = {}) {
    const typeKey = cap(type);
    if (!TYPE_MAP[typeKey]) throw new TypeError(`Property.type "${type}" unsupported`);
    if (!isBool(mandatory)) throw new TypeError(`Property.mandatory must be a boolean`);

    this.#typeClass = TYPE_MAP[typeKey];
    this.#mandatory = mandatory;
    this.#default   = d;
    this.#reference = reference;
    Object.freeze(this);
  }

  get typeClass() { return this.#typeClass; }
  get sqliteType() { return this.#typeClass.sqlite_type; }
  get isMandatory() { return this.#mandatory; }
  get default() { return this.#default; }
  get reference() { return this.#reference; }

  coerce(value) {
    if (isNil(value)) return value;
    // Date accepts string or Date; numbers for number types, etc.
    switch (this.sqliteType) {
      case "TEXT": {
        if (this.#typeClass === DateProperty) {
          const d = value instanceof Date ? value : new Date(value);
          return new DateProperty(d).to_sqlite();
        }
        return new this.#typeClass(value).to_sqlite();
      }
      case "INTEGER":
      case "REAL":
        return new this.#typeClass(value).to_sqlite();
      default:
        return value;
    }
  }

  sqlColumnClause(columnName) {
    const parts = [ident(columnName), this.sqliteType];
    if (this.isMandatory) parts.push("NOT NULL");
    if (!isNil(this.default)) {
      // Defaults: numbers as-is; strings quoted; dates as quoted text
      const def =
        typeof this.default === "number"
          ? String(this.default)
          : `'${String(this.coerce(this.default)).replace(/'/g, "''")}'`;
      parts.push(`DEFAULT ${def}`);
    }
    if (this.reference) {
      // very simple "table(column)" or "table.column"
      const m = this.reference.match(/([a-zA-Z0-9_]+)[\.\(]([a-zA-Z0-9_]+)\)?/);
      if (m) {
        const refTable = ident(m[1]);
        const refCol   = ident(m[2]);
        parts.push(`REFERENCES ${refTable}(${refCol})`);
      }
    }
    return parts.join(" ");
  }
}

// -- Model (schema holder) ----------------------------------------------------
class Model {
  #fields = new Map(); // name -> Property

  constructor(definition = {}) {
    for (const [key, raw] of Object.entries(definition)) {
      const normalized = normalizeFieldDefinition(raw);
      this.#fields.set(key, new Property(normalized));
    }
    Object.freeze(this);
  }

  fieldNames() { return Array.from(this.#fields.keys()); }
  get(key)     { return this.#fields.get(key); }
  entries()    { return Array.from(this.#fields.entries()); }
}

// -- ApplicationRecord --------------------------------------------------------
// Per-class prepared statement cache (works across subclasses)
const STATEMENTS = new WeakMap();
function statementsFor(klass) {
  let m = STATEMENTS.get(klass);
  if (!m) { m = new Map(); STATEMENTS.set(klass, m); }
  return m;
}

export class ApplicationRecord {
  // Override in subclasses:
  static namespace = "";  // e.g. "auth"
  static resources = "";  // e.g. "users"
  static resource  = "";  // e.g. "user"
  static model     = new Model(); // set per subclass

  static get table() {
    const resourcesName = this.resources || pluralizeWord(underscore(this.name).split('/').pop() || "");
    if (!resourcesName) throw new Error(`${this.name}.resources must be set or derivable from class name`);
    return this.namespace ? `${ident(this.namespace)}_${ident(resourcesName)}` : ident(resourcesName);
  }

  // --- Schema / migrations ---------------------------------------------------
  static migrate() {
    // Auto columns
    const columns = [
      "id INTEGER PRIMARY KEY AUTOINCREMENT",
      "created_at TEXT NOT NULL",
      "updated_at TEXT NOT NULL",
    ];

    for (const [name, prop] of this.model.entries()) {
      columns.push(prop.sqlColumnClause(name));
    }

    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.table} (
        ${columns.join(",\n        ")}
      );
    `;
    DB.exec(sql);
    return true;
  }

  // --- Statement cache helpers ----------------------------------------------
  static stmt(key, builder) {
    const cache = statementsFor(this);
    if (!cache.has(key)) cache.set(key, prepare(builder()));
    return cache.get(key);
  }

  // --- Query builders --------------------------------------------------------
  static selectSql({ where="", orderBy="", limit=null, offset=null } = {}) {
    let sql = `SELECT * FROM ${this.table}`;
    if (where)  sql += ` WHERE ${where}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    if (limit != null)  sql += ` LIMIT ${Number(limit)}`;
    if (offset != null) sql += ` OFFSET ${Number(offset)}`;
    return sql;
  }

  // --- Finder & scopes -------------------------------------------------------
  static all({ order = "id ASC", limit = null, offset = null } = {}) {
    const sql = this.selectSql({ orderBy: order, limit, offset });
    const stmt = this.stmt(`all:${sql}`, () => sql);
    const rows = stmt.allSync ? stmt.allSync() : stmt.all();
    return rows.map(r => this.instantiate(r));
  }

  static first() {
    const sql = this.selectSql({ orderBy: "id ASC", limit: 1 });
    const stmt = this.stmt("first", () => sql);
    const row = stmt.getSync ? stmt.getSync() : stmt.get();
    return row ? this.instantiate(row) : null;
  }

  static last() {
    const sql = this.selectSql({ orderBy: "id DESC", limit: 1 });
    const stmt = this.stmt("last", () => sql);
    const row = stmt.getSync ? stmt.getSync() : stmt.get();
    return row ? this.instantiate(row) : null;
  }

  static find(id) {
    const sql = `SELECT * FROM ${this.table} WHERE id = :id LIMIT 1`;
    const stmt = this.stmt("findById", () => sql);
    const row = (stmt.bind({ id }).getSync ? stmt.bind({ id }).getSync() : stmt.bind({ id }).get());
    if (!row) return null;
    return this.instantiate(row);
  }

  static where(clauses = {}, { order = "id ASC", limit = null, offset = null } = {}) {
    const keys = Object.keys(clauses);
    if (keys.length === 0) return this.all({ order, limit, offset });

    const where = keys.map(k => `${ident(k)} = :${ident(k)}`).join(" AND ");
    const sql   = this.selectSql({ where, orderBy: order, limit, offset });
    const stmt  = this.stmt(`where:${where}|${order}|${limit}|${offset}`, () => sql);

    const rowset = stmt.bind(clauses);
    const rows = rowset.allSync ? rowset.allSync() : rowset.all();
    return rows.map(r => this.instantiate(r));
  }

  static find_by(clauses = {}) {
    const keys = Object.keys(clauses);
    if (keys.length === 0) return null;
    const where = keys.map(k => `${ident(k)} = :${ident(k)}`).join(" AND ");
    const sql = `${this.selectSql({ where, orderBy: "id ASC", limit: 1 })}`;
    const stmt = this.stmt(`find_by:${where}`, () => sql);
    const row = stmt.bind(clauses).getSync ? stmt.bind(clauses).getSync() : stmt.bind(clauses).get();
    return row ? this.instantiate(row) : null;
  }

  static count(clauses = {}) {
    const keys = Object.keys(clauses);
    const where = keys.length ? ` WHERE ${keys.map(k => `${ident(k)} = :${ident(k)}`).join(" AND ")}` : "";
    const sql = `SELECT COUNT(1) AS count FROM ${this.table}${where}`;
    const stmt = this.stmt(`count:${where}`, () => sql);
    const row = keys.length ? (stmt.bind(clauses).getSync ? stmt.bind(clauses).getSync() : stmt.bind(clauses).get())
                            : (stmt.getSync ? stmt.getSync() : stmt.get());
    return row ? Number(row.count) : 0;
  }

  static order(order = "id ASC") {
    return this.all({ order });
  }

  // --- Create / Update / Destroy --------------------------------------------
  static create(attrs = {}) {
    const ts = nowIso();
    const record = new this({ ...attrs, created_at: ts, updated_at: ts });
    record.save();
    return record;
  }

  static ["create!"](attrs = {}) {
    const ts = nowIso();
    const record = new this({ ...attrs, created_at: ts, updated_at: ts });
    record["save!"]();
    return record;
  }

  static update(id, attrs = {}) {
    const rec = this.find(id);
    if (!rec) return null;
    rec.assign(attrs);
    rec.save();
    return rec;
    }

  static destroy(id) {
    const sql = `DELETE FROM ${this.table} WHERE id = :id`;
    // Prefer direct DB.run to avoid prepared-statement differences
    try {
      if (typeof DB.runSync === 'function') return DB.runSync(sql, { id });
      return DB.run(sql, { id });
    } catch (_) {
      const stmt = this.stmt("destroy", () => sql);
      const res = stmt.bind({ id });
      if (res.runSync) return res.runSync();
      if (res.run) return res.run();
      return null;
    }
  }

  // --- Instantiation & persistence ------------------------------------------
  static instantiate(raw = {}) {
    const instance = new this();
    // Reinitialize storage cleanly without redefining descriptors
    instance.__data = instance.__data || {};
    instance.__changed = new Set();
    instance.__destroyed = false;
    instance.errors = instance.errors || new Errors();

    // id/created_at/updated_at
    if (!isNil(raw.id)) instance.__data.id = raw.id;
    instance.__data.created_at = raw.created_at ?? instance.__data.created_at ?? nowIso();
    instance.__data.updated_at = raw.updated_at ?? instance.__data.updated_at ?? nowIso();

    // assign schema fields (do not redefine property descriptors here)
    for (const [name, prop] of this.model.entries()) {
      const val = raw[name];
      instance.__data[name] = isNil(val) ? prop.default : prop.coerce(val);
    }

    // Ensure method bindings in case constructor didn’t bind (defensive)
    instance.save      = instance.save?.bind(instance)      || this.prototype.save.bind(instance);
    instance["save!"]   = instance["save!"]?.bind(instance)   || this.prototype["save!"].bind(instance);
    instance.reload    = instance.reload?.bind(instance)    || this.prototype.reload.bind(instance);
    instance.assign    = instance.assign?.bind(instance)    || this.prototype.assign.bind(instance);
    instance.update    = instance.update?.bind(instance)    || this.prototype.update.bind(instance);
    instance["update!"] = instance["update!"]?.bind(instance) || this.prototype["update!"].bind(instance);
    instance.destroy   = instance.destroy?.bind(instance)   || this.prototype.destroy.bind(instance);
    instance["destroy!"] = instance["destroy!"]?.bind(instance) || this.prototype["destroy!"].bind(instance);
    instance.valid     = instance.valid?.bind(instance)     || this.prototype.valid.bind(instance);
    instance.validate  = instance.validate?.bind(instance)  || this.prototype.validate.bind(instance);
    instance.persisted = instance.persisted?.bind(instance) || this.prototype.persisted.bind(instance);
    instance.isNewRecord = instance.isNewRecord?.bind(instance) || this.prototype.isNewRecord.bind(instance);
    instance.toJSON    = instance.toJSON?.bind(instance)    || this.prototype.toJSON.bind(instance);

    return instance;
  }

  // Allow new Model(attrs) construction like Rails' Model.new
  constructor(attrs = {}) {
    const Ctor = this.constructor;
    // If we detect uninitialized instance (no __data), set up descriptors
    if (!this.__data) {
      this.__data = {};
      this.__changed = new Set();
      this.__destroyed = false;
      this.errors = new Errors();

      // id/created_at/updated_at defaults
      Object.defineProperty(this, "id", { enumerable: true, get: () => this.__data.id });
      Object.defineProperty(this, "created_at", { enumerable: true, get: () => this.__data.created_at });
      Object.defineProperty(this, "updated_at", { enumerable: true, get: () => this.__data.updated_at });

      this.__data.created_at = attrs.created_at ?? nowIso();
      this.__data.updated_at = attrs.updated_at ?? nowIso();

      for (const [name, prop] of Ctor.model.entries()) {
        const initial = Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : prop.default;
        this.__data[name] = isNil(initial) ? prop.default : prop.coerce(initial);
        Object.defineProperty(this, name, {
          enumerable: true,
          configurable: false,
          get: () => this.__data[name],
          set: (v) => { this.__data[name] = prop.coerce(v); this.__changed.add(name); },
        });
      }

      // Bind instance methods
      this.save    = this.save.bind(this);
      this["save!"] = this["save!"].bind(this);
      this.reload  = this.reload.bind(this);
      this.assign  = this.assign.bind(this);
      this.update  = this.update.bind(this);
      this["update!"] = this["update!"].bind(this);
      this.destroy = this.destroy.bind(this);
      this["destroy!"] = this["destroy!"].bind(this);
      this.valid   = this.valid.bind(this);
      this.validate= this.validate.bind(this);
      this.persisted = this.persisted.bind(this);
      this.isNewRecord = this.isNewRecord.bind(this);
      this.toJSON  = this.toJSON.bind(this);
    }
    // Assign attributes (Rails: new(attrs))
    this.assign(attrs);
    return this;
  }

  // Merge attributes into instance (no DB I/O)
  assign(attrs = {}) {
    for (const [k, v] of Object.entries(attrs)) {
      // Protect meta fields from external assignment through accessors
      if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
      if (k in this.__data) this[k] = v;
    }
    return this;
  }

  // Run standard + custom validations
  _runValidations() {
    const Ctor = this.constructor;
    this.errors.clear();
    for (const [name, prop] of Ctor.model.entries()) {
      if (prop.isMandatory && isNil(this.__data[name])) {
        this.errors.add(name, "can't be blank");
      }
    }
    this.validate();
    return this.errors.isEmpty();
  }

  // Insert or update
  save() {
    const Ctor = this.constructor;
    if (!this._runValidations()) return false;

    if (!this.id) {
      // INSERT
      const cols = ["created_at", "updated_at", ...Ctor.model.fieldNames()];
      const sql = `
        INSERT INTO ${Ctor.table} (${joinCols(cols)})
        VALUES (${namedParams(cols)})
        RETURNING *
      `;
      const stmt = Ctor.stmt("insert:" + cols.join(","), () => sql);

      const params = {};
      for (const c of cols) params[c] = this.__data[c];

      const row = (stmt.bind(params).getSync ? stmt.bind(params).getSync() : stmt.bind(params).get());
      // rehydrate (replace backing store)
      const fresh = Ctor.instantiate(row);
      this.__data = fresh.__data;
      this.__changed.clear();
      return true;
    } else {
      // UPDATE (only changed columns)
      if (this.__changed.size === 0) return true;
      this.__data.updated_at = nowIso();

      const changed = Array.from(this.__changed);
      const setFrag = ["updated_at", ...changed].map(c => `${ident(c)} = :${ident(c)}`).join(", ");
      const sql = `
        UPDATE ${Ctor.table}
        SET ${setFrag}
        WHERE id = :id
        RETURNING *
      `;
      const stmt = Ctor.stmt("update:" + changed.sort().join(","), () => sql);

      const params = { id: this.id, updated_at: this.__data.updated_at };
      for (const c of changed) params[c] = this.__data[c];

      const row = (stmt.bind(params).getSync ? stmt.bind(params).getSync() : stmt.bind(params).get());
      const fresh = Ctor.instantiate(row);
      this.__data = fresh.__data;
      this.__changed.clear();
      return true;
    }
  }

  // save! — raises on validation failure (Rails convention)
  ["save!"]() {
    const ok = this.save();
    if (!ok) throw new Error(this.errors.fullMessage());
    return true;
  }

  reload() {
    const Ctor = this.constructor;
    if (!this.id) return this;
    const fresh = Ctor.find(this.id);
    if (!fresh) return this;
    this.__data = fresh.__data;
    this.__changed = new Set();
    return this;
  }

  destroy() {
    const Ctor = this.constructor;
    if (!this.id) return null;
    const res = Ctor.destroy(this.id);
    this.__destroyed = true;
    return res;
  }

  ["destroy!"]() {
    const res = this.destroy();
    if (res == null) throw new Error("cannot destroy a non-persisted record");
    return res;
  }

  update(attrs = {}) {
    this.assign(attrs);
    return this.save();
  }

  ["update!"] (attrs = {}) {
    this.assign(attrs);
    return this["save!"]();
  }

  // Validation API (override validate() in subclasses)
  validate() { /* no-op by default */ }
  valid() { return this._runValidations(); }
  isNewRecord() { return !this.id; }
  persisted() { return !!this.id && !this.__destroyed; }
  toJSON() { return { ...this.__data }; }
}

/*
// -- Example model ------------------------------------------------------------
// You can place this in your app/models/user.mjs and import ApplicationRecord above.

export class User extends ApplicationRecord {
  static resources = "users";
  static resource  = "user";
  static model = new Model({
    // Accepts concise array form or object form:
    // email: ["string", "mandatory", null],
    email: { type: "string", mandatory: true },
    name:  { type: "string", mandatory: false, default: "" },
    age:   { type: "integer", default: 0 },
    // Example reference: team_id INTEGER REFERENCES teams(id)
    // team_id: { type: "integer", reference: "teams(id)" },
  });
}
*/
