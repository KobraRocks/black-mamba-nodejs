#include <node_api.h>
#include <assert.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <limits>
#include <sqlite3.h>
#include <cstring>

// forward decl
static napi_value make_resolved(napi_env env, napi_value value);

struct DB {
  sqlite3* handle{nullptr};
  std::string path;
  uint32_t flags{0};
  bool open{false};
};

struct STMT {
  DB* db{nullptr};
  sqlite3_stmt* handle{nullptr};
  std::string sql;
  napi_ref bound{nullptr}; // last bound params (optional)
};

// Row marshaling for async workers
struct Cell { int type; std::string s; std::vector<uint8_t> b; sqlite3_int64 i; double d; };
struct RowData { std::vector<std::string> names; std::vector<Cell> cells; };

static void finalize_db(napi_env env, void* data, void* /*hint*/) {
  DB* db = (DB*)data;
  if (db) {
    if (db->handle) sqlite3_close(db->handle);
    delete db;
  }
}

static DB* unwrap_db(napi_env env, napi_value ext) {
  void* data = nullptr;
  napi_status st = napi_get_value_external(env, ext, &data);
  if (st != napi_ok) return nullptr;
  return (DB*)data;
}

static napi_value make_external_db(napi_env env, DB* db) {
  napi_value ext;
  napi_status st = napi_create_external(env, db, finalize_db, nullptr, &ext);
  assert(st == napi_ok);
  return ext;
}

static napi_value throw_error(napi_env env, const char* msg) {
  napi_throw_error(env, nullptr, msg);
  return nullptr;
}

static napi_value sqliteVersion(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_create_string_utf8(env, sqlite3_libversion(), NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value openSync(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return throw_error(env, "path required");
  size_t len; napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);
  std::string path; path.resize(len);
  napi_get_value_string_utf8(env, argv[0], &path[0], len+1, &len);
  uint32_t flags = 0; if (argc >= 2) napi_get_value_uint32(env, argv[1], &flags);

  DB* db = new DB(); db->path = path; db->flags = flags;
  int rc = sqlite3_open(path.c_str(), &db->handle);
  if (rc != SQLITE_OK) {
    delete db; return throw_error(env, sqlite3_errstr(rc));
  }
  db->open = true;
  return make_external_db(env, db);
}

static napi_value dbPath(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]);
  napi_value out; napi_create_string_utf8(env, db?db->path.c_str():"", NAPI_AUTO_LENGTH, &out); return out;
}
static napi_value dbFlags(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]);
  napi_value out; napi_create_uint32(env, db?db->flags:0, &out); return out;
}
static napi_value dbIsOpen(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]);
  bool ok = db && db->open && db->handle;
  napi_value out; napi_get_boolean(env, ok, &out); return out;
}

static int bind_params(napi_env env, napi_value params, sqlite3_stmt* stmt) {
  if (params == nullptr) return SQLITE_OK;
  napi_valuetype t; napi_typeof(env, params, &t);
  if (t == napi_object) {
    bool isArray=false; napi_is_array(env, params, &isArray);
    if (isArray) {
      uint32_t len=0; napi_get_array_length(env, params, &len);
      for (uint32_t i=0;i<len;i++) {
        napi_value v; napi_get_element(env, params, i, &v);
        int idx = (int)i+1;
        napi_valuetype vt; napi_typeof(env, v, &vt);
        if (vt == napi_null || vt == napi_undefined) sqlite3_bind_null(stmt, idx);
        else if (vt == napi_number) {
          double d; napi_get_value_double(env, v, &d); sqlite3_bind_double(stmt, idx, d);
        } else if (vt == napi_bigint) {
          int64_t val; bool lossless; napi_get_value_bigint_int64(env, v, &val, &lossless); sqlite3_bind_int64(stmt, idx, val);
        } else if (vt == napi_string) {
          size_t sl; napi_get_value_string_utf8(env, v, nullptr, 0, &sl); std::string s; s.resize(sl);
          napi_get_value_string_utf8(env, v, &s[0], sl+1, &sl); sqlite3_bind_text(stmt, idx, s.c_str(), (int)sl, SQLITE_TRANSIENT);
        } else {
          // Attempt Uint8Array
          bool isTA=false; napi_is_typedarray(env, v, &isTA);
          if (isTA) {
            napi_typedarray_type tt; size_t len; void* data; napi_value ab; size_t off;
            napi_get_typedarray_info(env, v, &tt, &len, &data, &ab, &off);
            sqlite3_bind_blob(stmt, idx, data, (int)(len), SQLITE_TRANSIENT);
          } else {
            sqlite3_bind_null(stmt, idx);
          }
        }
      }
      return SQLITE_OK;
    } else {
      // named params
      napi_value keys; napi_get_property_names(env, params, &keys);
      uint32_t klen=0; napi_get_array_length(env, keys, &klen);
      for (uint32_t i=0;i<klen;i++) {
        napi_value k; napi_get_element(env, keys, i, &k);
        size_t kl; napi_get_value_string_utf8(env, k, nullptr, 0, &kl); std::string key; key.resize(kl);
        napi_get_value_string_utf8(env, k, &key[0], kl+1, &kl);
        napi_value v; napi_get_property(env, params, k, &v);
        std::string marker = ":" + key; int idx = sqlite3_bind_parameter_index(stmt, marker.c_str());
        if (idx == 0) { marker = "$" + key; idx = sqlite3_bind_parameter_index(stmt, marker.c_str()); }
        if (idx == 0) { marker = "@" + key; idx = sqlite3_bind_parameter_index(stmt, marker.c_str()); }
        if (idx == 0) continue;
        napi_valuetype vt; napi_typeof(env, v, &vt);
        if (vt == napi_null || vt == napi_undefined) sqlite3_bind_null(stmt, idx);
        else if (vt == napi_number) { double d; napi_get_value_double(env, v, &d); sqlite3_bind_double(stmt, idx, d);
        } else if (vt == napi_bigint) { int64_t val; bool lossless; napi_get_value_bigint_int64(env, v, &val, &lossless); sqlite3_bind_int64(stmt, idx, val);
        } else if (vt == napi_string) { size_t sl; napi_get_value_string_utf8(env, v, nullptr, 0, &sl); std::string s; s.resize(sl); napi_get_value_string_utf8(env, v, &s[0], sl+1, &sl); sqlite3_bind_text(stmt, idx, s.c_str(), (int)sl, SQLITE_TRANSIENT);
        } else {
          bool isTA=false; napi_is_typedarray(env, v, &isTA);
          if (isTA) { napi_typedarray_type tt; size_t len; void* data; napi_value ab; size_t off; napi_get_typedarray_info(env, v, &tt, &len, &data, &ab, &off); sqlite3_bind_blob(stmt, idx, data, (int)(len), SQLITE_TRANSIENT); }
          else sqlite3_bind_null(stmt, idx);
        }
      }
      return SQLITE_OK;
    }
  }
  return SQLITE_OK;
}

static napi_value make_result_changes(napi_env env, sqlite3* h) {
  napi_value obj; napi_create_object(env, &obj);
  napi_value changes; napi_create_int32(env, sqlite3_changes(h), &changes);
  napi_set_named_property(env, obj, "changes", changes);
  napi_value rowid; napi_create_bigint_int64(env, sqlite3_last_insert_rowid(h), &rowid);
  napi_set_named_property(env, obj, "lastInsertRowid", rowid);
  return obj;
}

static napi_value dbExecSync(napi_env env, napi_callback_info info) {
  size_t argc=3; napi_value argv[3]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string sql; sql.resize(sl);
  napi_get_value_string_utf8(env, argv[1], &sql[0], sl+1, &sl);
  char* err = nullptr; int rc = sqlite3_exec(db->handle, sql.c_str(), nullptr, nullptr, &err);
  if (rc != SQLITE_OK) { std::string msg = err?err:sqlite3_errstr(rc); if (err) sqlite3_free(err); return throw_error(env, msg.c_str()); }
  napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
}

static napi_value dbRunSync(napi_env env, napi_callback_info info) {
  size_t argc=4; napi_value argv[4]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string sql; sql.resize(sl);
  napi_get_value_string_utf8(env, argv[1], &sql[0], sl+1, &sl);
  sqlite3_stmt* stmt=nullptr; int rc = sqlite3_prepare_v2(db->handle, sql.c_str(), (int)sql.size(), &stmt, nullptr);
  if (rc != SQLITE_OK) return throw_error(env, sqlite3_errmsg(db->handle));
  if (argc >= 3) bind_params(env, argv[2], stmt);
  rc = sqlite3_step(stmt);
  if (rc!=SQLITE_DONE && rc!=SQLITE_ROW) { sqlite3_finalize(stmt); return throw_error(env, sqlite3_errmsg(db->handle)); }
  sqlite3_finalize(stmt);
  return make_result_changes(env, db->handle);
}

static napi_value row_from_stmt(napi_env env, sqlite3_stmt* stmt) {
  int colc = sqlite3_column_count(stmt);
  napi_value obj; napi_create_object(env, &obj);
  for (int i=0;i<colc;i++) {
    const char* name = sqlite3_column_name(stmt, i);
    int t = sqlite3_column_type(stmt, i);
    napi_value v;
    switch (t) {
      case SQLITE_INTEGER: {
        sqlite3_int64 iv = sqlite3_column_int64(stmt, i);
        // choose number if safe
        if (iv >= std::numeric_limits<int64_t>::min() && iv <= std::numeric_limits<int64_t>::max()) {
          // prefer bigint to avoid precision loss
          napi_create_bigint_int64(env, iv, &v);
        }
        break;
      }
      case SQLITE_FLOAT: {
        double d = sqlite3_column_double(stmt, i);
        napi_create_double(env, d, &v);
        break;
      }
      case SQLITE_TEXT: {
        const unsigned char* txt = sqlite3_column_text(stmt, i);
        napi_create_string_utf8(env, (const char*)txt, NAPI_AUTO_LENGTH, &v);
        break;
      }
      case SQLITE_BLOB: {
        const void* b = sqlite3_column_blob(stmt, i);
        int n = sqlite3_column_bytes(stmt, i);
        void* data; napi_value ab; napi_create_arraybuffer(env, n, &data, &ab);
        if (n>0 && b) memcpy(data, b, n);
        napi_value ta; napi_create_typedarray(env, napi_uint8_array, n, ab, 0, &ta);
        v = ta; break;
      }
      case SQLITE_NULL:
      default: { napi_get_null(env, &v); }
    }
    napi_set_named_property(env, obj, name, v);
  }
  return obj;
}

static napi_value dbGetSync(napi_env env, napi_callback_info info) {
  size_t argc=4; napi_value argv[4]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string sql; sql.resize(sl);
  napi_get_value_string_utf8(env, argv[1], &sql[0], sl+1, &sl);
  sqlite3_stmt* stmt=nullptr; int rc = sqlite3_prepare_v2(db->handle, sql.c_str(), (int)sql.size(), &stmt, nullptr);
  if (rc != SQLITE_OK) return throw_error(env, sqlite3_errmsg(db->handle));
  if (argc >= 3) bind_params(env, argv[2], stmt);
  napi_value result; napi_get_undefined(env, &result);
  rc = sqlite3_step(stmt);
  if (rc == SQLITE_ROW) {
    result = row_from_stmt(env, stmt);
  } else if (rc != SQLITE_DONE) {
    sqlite3_finalize(stmt); return throw_error(env, sqlite3_errmsg(db->handle));
  }
  sqlite3_finalize(stmt);
  return result;
}

static napi_value dbAllSync(napi_env env, napi_callback_info info) {
  size_t argc=4; napi_value argv[4]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string sql; sql.resize(sl);
  napi_get_value_string_utf8(env, argv[1], &sql[0], sl+1, &sl);
  sqlite3_stmt* stmt=nullptr; int rc = sqlite3_prepare_v2(db->handle, sql.c_str(), (int)sql.size(), &stmt, nullptr);
  if (rc != SQLITE_OK) return throw_error(env, sqlite3_errmsg(db->handle));
  if (argc >= 3) bind_params(env, argv[2], stmt);
  napi_value arr; napi_create_array(env, &arr);
  uint32_t idx=0;
  while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
    napi_value row = row_from_stmt(env, stmt);
    napi_set_element(env, arr, idx++, row);
  }
  if (rc != SQLITE_DONE) { sqlite3_finalize(stmt); return throw_error(env, sqlite3_errmsg(db->handle)); }
  sqlite3_finalize(stmt);
  return arr;
}

static napi_value dbCloseSync(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db) return nullptr;
  if (db->handle) { sqlite3_close(db->handle); db->handle=nullptr; db->open=false; }
  napi_value undefined; napi_get_undefined(env, &undefined); return undefined;
}

// Prepared statements
static void finalize_stmt(napi_env env, void* data, void* /*hint*/) {
  STMT* s = (STMT*)data;
  if (!s) return;
  if (s->handle) sqlite3_finalize(s->handle);
  if (s->bound) napi_delete_reference(env, s->bound);
  delete s;
}

static STMT* unwrap_stmt(napi_env env, napi_value ext) {
  void* data = nullptr; napi_get_value_external(env, ext, &data); return (STMT*)data;
}

static napi_value make_external_stmt(napi_env env, STMT* s) {
  napi_value ext; napi_create_external(env, s, finalize_stmt, nullptr, &ext); return ext;
}

static napi_value dbPrepareSync(napi_env env, napi_callback_info info) {
  size_t argc=3; napi_value argv[3]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string sql; sql.resize(sl);
  napi_get_value_string_utf8(env, argv[1], &sql[0], sl+1, &sl);
  STMT* s = new STMT(); s->db = db; s->sql = sql;
  int rc = sqlite3_prepare_v2(db->handle, sql.c_str(), (int)sql.size(), &s->handle, nullptr);
  if (rc != SQLITE_OK) { delete s; return throw_error(env, sqlite3_errmsg(db->handle)); }
  return make_external_stmt(env, s);
}

static napi_value stmtSql(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); napi_value out; napi_create_string_utf8(env, s?s->sql.c_str():"", NAPI_AUTO_LENGTH, &out); return out;
}

static napi_value stmtBind(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s||!s->handle) return throw_error(env, "stmt finalized");
  if (s->bound) { napi_delete_reference(env, s->bound); s->bound = nullptr; }
  if (argc>=2) {
    napi_create_reference(env, argv[1], 1, &s->bound);
  }
  napi_value self; napi_get_undefined(env, &self); return self;
}

static napi_value stmtReset(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s||!s->handle) return throw_error(env, "stmt finalized");
  sqlite3_reset(s->handle);
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}

static napi_value stmtFinalizeSync(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s) return nullptr;
  if (s->handle) { sqlite3_finalize(s->handle); s->handle=nullptr; }
  if (s->bound) { napi_delete_reference(env, s->bound); s->bound=nullptr; }
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}

static napi_value stmtStepSync(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s||!s->handle) return throw_error(env, "stmt finalized");
  // rebind
  if (s->bound) { napi_value params; napi_get_reference_value(env, s->bound, &params); sqlite3_clear_bindings(s->handle); bind_params(env, params, s->handle); }
  int rc = sqlite3_step(s->handle);
  bool hasRow = (rc == SQLITE_ROW);
  if (!(rc == SQLITE_ROW || rc == SQLITE_DONE)) return throw_error(env, sqlite3_errmsg(s->db->handle));
  napi_value out; napi_get_boolean(env, hasRow, &out); return out;
}

static napi_value stmtGetSync(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s||!s->handle) return throw_error(env, "stmt finalized");
  // Bind and step once
  if (s->bound) { napi_value params; napi_get_reference_value(env, s->bound, &params); sqlite3_clear_bindings(s->handle); sqlite3_reset(s->handle); bind_params(env, params, s->handle); }
  int rc = sqlite3_step(s->handle);
  if (rc == SQLITE_ROW) {
    napi_value row = row_from_stmt(env, s->handle);
    return row;
  }
  if (rc == SQLITE_DONE) { napi_value u; napi_get_undefined(env, &u); return u; }
  return throw_error(env, sqlite3_errmsg(s->db->handle));
}

static napi_value stmtAllSync(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  STMT* s = unwrap_stmt(env, argv[0]); if (!s||!s->handle) return throw_error(env, "stmt finalized");
  int limit = 0; if (argc>=2) napi_get_value_int32(env, argv[1], &limit);
  if (s->bound) { napi_value params; napi_get_reference_value(env, s->bound, &params); sqlite3_clear_bindings(s->handle); sqlite3_reset(s->handle); bind_params(env, params, s->handle); }
  napi_value arr; napi_create_array(env, &arr); uint32_t idx=0; int count=0; int rc;
  while ((rc = sqlite3_step(s->handle)) == SQLITE_ROW) {
    napi_value row = row_from_stmt(env, s->handle);
    napi_set_element(env, arr, idx++, row);
    if (limit>0 && ++count >= limit) break;
  }
  if (!(rc == SQLITE_DONE || rc == SQLITE_ROW)) return throw_error(env, sqlite3_errmsg(s->db->handle));
  return arr;
}

// Async resolved promises for stmt methods
static napi_value stmtStep(napi_env env, napi_callback_info info) { napi_value v = stmtStepSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }
static napi_value stmtGet(napi_env env, napi_callback_info info) { napi_value v = stmtGetSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }
static napi_value stmtAll(napi_env env, napi_callback_info info) { napi_value v = stmtAllSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }
static napi_value stmtFinalize(napi_env env, napi_callback_info info) { napi_value v = stmtFinalizeSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }

static napi_value dbPrepare(napi_env env, napi_callback_info info) { napi_value v = dbPrepareSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }

// Async wrappers: resolve immediately by calling sync versions on main thread (simple but non-blocking API shape)
static napi_value make_resolved(napi_env env, napi_value value) {
  napi_deferred def; napi_value promise; napi_create_promise(env, &def, &promise);
  napi_resolve_deferred(env, def, value);
  return promise;
}

static napi_value openAsync(napi_env env, napi_callback_info info) {
  napi_value sync = openSync(env, info); if (!sync) return nullptr; return make_resolved(env, sync);
}
static napi_value dbExec(napi_env env, napi_callback_info info) { napi_value res = dbExecSync(env, info); if (res==nullptr) return nullptr; napi_value undef; napi_get_undefined(env, &undef); return make_resolved(env, undef); }
static napi_value dbRun(napi_env env, napi_callback_info info) { napi_value val = dbRunSync(env, info); if (!val) return nullptr; return make_resolved(env, val); }
static napi_value dbGet(napi_env env, napi_callback_info info) { napi_value val = dbGetSync(env, info); if (!val) return nullptr; return make_resolved(env, val); }
static napi_value dbAll(napi_env env, napi_callback_info info) {
  size_t argc=4; napi_value argv[4]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t sl; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &sl); std::string* sql = new std::string(); sql->resize(sl);
  napi_get_value_string_utf8(env, argv[1], &(*sql)[0], sl+1, &sl);
  struct Work { DB* db; std::string* sql; napi_ref params_ref; int rc; std::string err; std::vector<RowData> rows; napi_async_work work; napi_deferred def; };
  Work* w = new Work{ db, sql, nullptr, SQLITE_OK, std::string(), {}, nullptr, nullptr };
  if (argc>=3) { napi_create_reference(env, argv[2], 1, &w->params_ref);} 
  napi_value promise; napi_create_promise(env, &w->def, &promise);
  napi_value resource_name; napi_create_string_utf8(env, "dbAll", NAPI_AUTO_LENGTH, &resource_name);
  auto Execute = [](napi_env env, void* data){ Work* w=(Work*)data; sqlite3_stmt* stmt=nullptr; int rc=sqlite3_prepare_v2(w->db->handle, w->sql->c_str(), (int)w->sql->size(), &stmt, nullptr); if (rc!=SQLITE_OK){ w->rc=rc; w->err=sqlite3_errmsg(w->db->handle); return;} if (w->params_ref){ napi_value params; napi_get_reference_value(env, w->params_ref, &params); bind_params(env, params, stmt);} int cols=sqlite3_column_count(stmt); while ((rc=sqlite3_step(stmt))==SQLITE_ROW){ RowData row; row.names.reserve(cols); row.cells.reserve(cols); for (int i=0;i<cols;i++){ const char* name=sqlite3_column_name(stmt,i); row.names.emplace_back(name?name:""); int t=sqlite3_column_type(stmt,i); Cell c; c.type=t; switch(t){ case SQLITE_INTEGER: c.i=sqlite3_column_int64(stmt,i); break; case SQLITE_FLOAT: c.d=sqlite3_column_double(stmt,i); break; case SQLITE_TEXT: { const unsigned char* txt=sqlite3_column_text(stmt,i); int n=sqlite3_column_bytes(stmt,i); c.s.assign((const char*)txt, (size_t)n); } break; case SQLITE_BLOB: { const void* b=sqlite3_column_blob(stmt,i); int n=sqlite3_column_bytes(stmt,i); c.b.resize(n); if (n>0&&b) memcpy(c.b.data(), b, n); } break; case SQLITE_NULL: default: break; } row.cells.emplace_back(std::move(c)); } w->rows.emplace_back(std::move(row)); } w->rc = rc; if (rc!=SQLITE_DONE){ w->err=sqlite3_errmsg(w->db->handle);} sqlite3_finalize(stmt); };
  auto Complete = [](napi_env env, napi_status status, void* data){ Work* w=(Work*)data; napi_handle_scope hs; napi_open_handle_scope(env, &hs); if (w->rc==SQLITE_DONE){ napi_value arr; napi_create_array(env, &arr); uint32_t idx=0; for (auto &row : w->rows){ napi_value obj; napi_create_object(env, &obj); for (size_t i=0;i<row.cells.size();++i){ napi_value v; Cell const& c=row.cells[i]; switch(c.type){ case SQLITE_INTEGER: napi_create_bigint_int64(env, c.i, &v); break; case SQLITE_FLOAT: napi_create_double(env, c.d, &v); break; case SQLITE_TEXT: napi_create_string_utf8(env, c.s.c_str(), NAPI_AUTO_LENGTH, &v); break; case SQLITE_BLOB: { void* dataPtr; napi_value ab; napi_create_arraybuffer(env, c.b.size(), &dataPtr, &ab); if (!c.b.empty()) memcpy(dataPtr, c.b.data(), c.b.size()); napi_create_typedarray(env, napi_uint8_array, c.b.size(), ab, 0, &v); } break; case SQLITE_NULL: default: napi_get_null(env, &v);} napi_set_named_property(env, obj, row.names[i].c_str(), v);} napi_set_element(env, arr, idx++, obj);} napi_resolve_deferred(env, w->def, arr);} else { napi_value msg; napi_create_string_utf8(env, w->err.c_str(), NAPI_AUTO_LENGTH, &msg); napi_reject_deferred(env, w->def, msg);} napi_close_handle_scope(env, hs); if (w->params_ref) napi_delete_reference(env, w->params_ref); napi_delete_async_work(env, w->work); delete w->sql; delete w; };
  napi_create_async_work(env, nullptr, resource_name, Execute, Complete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

// Transaction sync helper
static napi_value dbTxSync(napi_env env, napi_callback_info info) {
  size_t argc=3; napi_value argv[3]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  // mode string
  std::string mode; if (argc>=2) { size_t ml; napi_get_value_string_utf8(env, argv[1], nullptr, 0, &ml); mode.resize(ml); napi_get_value_string_utf8(env, argv[1], &mode[0], ml+1, &ml);} 
  napi_value fn = (argc>=3 ? argv[2] : nullptr);
  std::string begin = "BEGIN"; if (!mode.empty()) { begin += " "; for(char &c: mode){ begin += (char)toupper(c); } begin += " TRANSACTION"; }
  char* err=nullptr; int rc = sqlite3_exec(db->handle, begin.c_str(), nullptr, nullptr, &err); if (rc!=SQLITE_OK){ if(err){ std::string em=err; sqlite3_free(err); return throw_error(env, em.c_str()); } return throw_error(env, sqlite3_errmsg(db->handle)); }
  napi_value result; napi_get_undefined(env, &result);
  bool rolled=false;
  if (fn) {
    napi_value recv; napi_get_undefined(env, &recv);
    napi_status st = napi_call_function(env, recv, fn, 0, nullptr, &result);
    if (st != napi_ok) {
      sqlite3_exec(db->handle, "ROLLBACK", nullptr, nullptr, nullptr);
      rolled=true;
      // rethrow pending exception
      napi_value exc; if (napi_get_and_clear_last_exception(env, &exc)==napi_ok) napi_throw(env, exc);
      return nullptr;
    }
  }
  if (!rolled) {
    rc = sqlite3_exec(db->handle, "COMMIT", nullptr, nullptr, &err);
    if (rc!=SQLITE_OK){ sqlite3_exec(db->handle, "ROLLBACK", nullptr, nullptr, nullptr); if(err){ std::string em=err; sqlite3_free(err); return throw_error(env, em.c_str()); } return throw_error(env, sqlite3_errmsg(db->handle)); }
  }
  return result;
}

// Interrupt and checkpoint
static napi_value dbInterrupt(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (db&&db->handle) sqlite3_interrupt(db->handle);
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}

static napi_value dbCheckpointSync(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  DB* db = unwrap_db(env, argv[0]); if (!db||!db->handle) return throw_error(env, "db closed");
  size_t ml=0; const char* modeStr="PASSIVE"; if (argc>=2){ napi_get_value_string_utf8(env, argv[1], nullptr, 0, &ml); std::string m; m.resize(ml); napi_get_value_string_utf8(env, argv[1], &m[0], ml+1, &ml); if (ml>0) modeStr = strdup(m.c_str()); }
  int mode = SQLITE_CHECKPOINT_PASSIVE;
  if (strcmp(modeStr, "FULL")==0) mode = SQLITE_CHECKPOINT_FULL;
  else if (strcmp(modeStr, "RESTART")==0) mode = SQLITE_CHECKPOINT_RESTART;
  else if (strcmp(modeStr, "TRUNCATE")==0) mode = SQLITE_CHECKPOINT_TRUNCATE;
  int rc = sqlite3_wal_checkpoint_v2(db->handle, nullptr, mode, nullptr, nullptr);
  if (rc!=SQLITE_OK) return throw_error(env, sqlite3_errmsg(db->handle));
  napi_value undef; napi_get_undefined(env, &undef); return undef;
}
static napi_value dbCheckpoint(napi_env env, napi_callback_info info) { napi_value v = dbCheckpointSync(env, info); if (!v) return nullptr; return make_resolved(env, v); }

static napi_value Init(napi_env env, napi_value exports) {
  // Export sqliteVersion string
  napi_value ver; napi_create_string_utf8(env, sqlite3_libversion(), NAPI_AUTO_LENGTH, &ver);
  napi_set_named_property(env, exports, "sqliteVersion", ver);

  // Export ERRORS map: codes (name->number) and names (number->name)
  napi_value errorsObj; napi_create_object(env, &errorsObj);
  napi_value codes; napi_create_object(env, &codes);
  napi_value names; napi_create_object(env, &names);
#define SET_CODE(name) do { \
  napi_value vnum; napi_create_int32(env, name, &vnum); \
  napi_set_named_property(env, codes, #name, vnum); \
  std::string key = std::to_string(name); \
  napi_value vstr; napi_create_string_utf8(env, #name, NAPI_AUTO_LENGTH, &vstr); \
  napi_set_named_property(env, names, key.c_str(), vstr); \
} while(0)
  SET_CODE(SQLITE_OK);
  SET_CODE(SQLITE_ERROR);
  SET_CODE(SQLITE_INTERNAL);
  SET_CODE(SQLITE_PERM);
  SET_CODE(SQLITE_ABORT);
  SET_CODE(SQLITE_BUSY);
  SET_CODE(SQLITE_LOCKED);
  SET_CODE(SQLITE_NOMEM);
  SET_CODE(SQLITE_READONLY);
  SET_CODE(SQLITE_INTERRUPT);
  SET_CODE(SQLITE_IOERR);
  SET_CODE(SQLITE_CORRUPT);
  SET_CODE(SQLITE_NOTFOUND);
  SET_CODE(SQLITE_FULL);
  SET_CODE(SQLITE_CANTOPEN);
  SET_CODE(SQLITE_PROTOCOL);
  SET_CODE(SQLITE_EMPTY);
  SET_CODE(SQLITE_SCHEMA);
  SET_CODE(SQLITE_TOOBIG);
  SET_CODE(SQLITE_CONSTRAINT);
  SET_CODE(SQLITE_MISMATCH);
  SET_CODE(SQLITE_MISUSE);
  SET_CODE(SQLITE_NOLFS);
  SET_CODE(SQLITE_AUTH);
  SET_CODE(SQLITE_FORMAT);
  SET_CODE(SQLITE_RANGE);
  SET_CODE(SQLITE_NOTADB);
  SET_CODE(SQLITE_NOTICE);
  SET_CODE(SQLITE_WARNING);
  SET_CODE(SQLITE_ROW);
  SET_CODE(SQLITE_DONE);
#undef SET_CODE
  napi_set_named_property(env, errorsObj, "codes", codes);
  napi_set_named_property(env, errorsObj, "names", names);
  napi_set_named_property(env, exports, "ERRORS", errorsObj);

  napi_property_descriptor fns[] = {
    { "open", 0, openAsync, 0, 0, 0, napi_default, 0 },
    { "openSync", 0, openSync, 0, 0, 0, napi_default, 0 },
    { "dbPath", 0, dbPath, 0, 0, 0, napi_default, 0 },
    { "dbFlags", 0, dbFlags, 0, 0, 0, napi_default, 0 },
    { "dbIsOpen", 0, dbIsOpen, 0, 0, 0, napi_default, 0 },
    { "dbExec", 0, dbExec, 0, 0, 0, napi_default, 0 },
    { "dbExecSync", 0, dbExecSync, 0, 0, 0, napi_default, 0 },
    { "dbRun", 0, dbRun, 0, 0, 0, napi_default, 0 },
    { "dbRunSync", 0, dbRunSync, 0, 0, 0, napi_default, 0 },
    { "dbGet", 0, dbGet, 0, 0, 0, napi_default, 0 },
    { "dbGetSync", 0, dbGetSync, 0, 0, 0, napi_default, 0 },
    { "dbAll", 0, dbAll, 0, 0, 0, napi_default, 0 },
    { "dbAllSync", 0, dbAllSync, 0, 0, 0, napi_default, 0 },
    { "dbInterrupt", 0, dbInterrupt, 0, 0, 0, napi_default, 0 },
    { "dbCheckpoint", 0, dbCheckpoint, 0, 0, 0, napi_default, 0 },
    { "dbCheckpointSync", 0, dbCheckpointSync, 0, 0, 0, napi_default, 0 },
    { "dbTxSync", 0, dbTxSync, 0, 0, 0, napi_default, 0 },
    { "dbCloseSync", 0, dbCloseSync, 0, 0, 0, napi_default, 0 },
    { "dbPrepare", 0, dbPrepare, 0, 0, 0, napi_default, 0 },
    { "dbPrepareSync", 0, dbPrepareSync, 0, 0, 0, napi_default, 0 },
    { "stmtSql", 0, stmtSql, 0, 0, 0, napi_default, 0 },
    { "stmtBind", 0, stmtBind, 0, 0, 0, napi_default, 0 },
    { "stmtStep", 0, stmtStep, 0, 0, 0, napi_default, 0 },
    { "stmtStepSync", 0, stmtStepSync, 0, 0, 0, napi_default, 0 },
    { "stmtGet", 0, stmtGet, 0, 0, 0, napi_default, 0 },
    { "stmtGetSync", 0, stmtGetSync, 0, 0, 0, napi_default, 0 },
    { "stmtAll", 0, stmtAll, 0, 0, 0, napi_default, 0 },
    { "stmtAllSync", 0, stmtAllSync, 0, 0, 0, napi_default, 0 },
    { "stmtReset", 0, stmtReset, 0, 0, 0, napi_default, 0 },
    { "stmtFinalize", 0, stmtFinalize, 0, 0, 0, napi_default, 0 },
    { "stmtFinalizeSync", 0, stmtFinalizeSync, 0, 0, 0, napi_default, 0 }
  };
  for (auto &d : fns) napi_define_properties(env, exports, 1, &d);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
