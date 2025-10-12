import { AutoVacuum, Encoding, JournalMode, LockingMode, Synchronous, TempStore } from './enums.js';
import { runSql } from './util.js';

function createBooleanPragma(dbPath, name) {
  return {
    setting: false,
    turnOn() { runSql(dbPath, `PRAGMA ${name} = ON;`, { json: false }); this.setting = true; },
    turnOff() { runSql(dbPath, `PRAGMA ${name} = OFF;`, { json: false }); this.setting = false; }
  };
}
function createNumericPragma(dbPath, name, method) {
  const obj = { setting: 0 };
  obj[method] = function(value) { runSql(dbPath, `PRAGMA ${name} = ${value};`, { json: false }); this.setting = value; };
  return obj;
}
function createDualNumericPragma(dbPath, name, methods) {
  const obj = { setting: 0 };
  for (const [method, transform] of Object.entries(methods)) {
    obj[method] = function(value) { const v = transform(value); runSql(dbPath, `PRAGMA ${name} = ${v};`, { json: false }); this.setting = v; };
  }
  return obj;
}
function createEnumPragma(dbPath, name, mapping, def) {
  const obj = { setting: def };
  for (const [method, [sqlValue, enumValue]] of Object.entries(mapping)) {
    obj[method] = function() { runSql(dbPath, `PRAGMA ${name} = ${sqlValue};`, { json: false }); this.setting = enumValue; };
  }
  return obj;
}
function createRunPragma(dbPath, name) {
  return { run(param) {
    if (param === undefined) runSql(dbPath, `PRAGMA ${name};`, { json: false });
    else runSql(dbPath, `PRAGMA ${name}(${param});`, { json: false });
  }};
}

export function createPragma(dbPath) {
  const pragma = {};
  pragma.analysisLimit = createNumericPragma(dbPath, 'analysis_limit', 'rowsSetTo');
  pragma.applicationId = createNumericPragma(dbPath, 'application_id', 'numberSetTo');
  pragma.autoVacuum = createEnumPragma(dbPath, 'auto_vacuum', {
    setToNone: ['NONE', AutoVacuum.NONE],
    setToFull: ['FULL', AutoVacuum.FULL],
    setToIncremental: ['INCREMENTAL', AutoVacuum.INCREMENTAL],
  }, AutoVacuum.NONE);
  pragma.automaticIndex = createBooleanPragma(dbPath, 'automatic_index');
  pragma.busyTimeout = createNumericPragma(dbPath, 'busy_timeout', 'millisecondsSetTo');
  pragma.cacheSize = createDualNumericPragma(dbPath, 'cache_size', { pagesSetTo: v => v, kilobytesSetTo: v => -v });
  pragma.cacheSpill = createBooleanPragma(dbPath, 'cache_spill');
  pragma.caseSensitiveLike = createBooleanPragma(dbPath, 'case_sensitive_like');
  pragma.cellSizeCheck = createBooleanPragma(dbPath, 'cell_size_check');
  pragma.checkpointFullfsync = createBooleanPragma(dbPath, 'checkpoint_fullfsync');
  pragma.collationList = createRunPragma(dbPath, 'collation_list');
  pragma.compileOptions = createRunPragma(dbPath, 'compile_options');
  pragma.countChanges = createBooleanPragma(dbPath, 'count_changes');
  pragma.dataVersion = createRunPragma(dbPath, 'data_version');
  pragma.databaseList = createRunPragma(dbPath, 'database_list');
  pragma.defaultCacheSize = createDualNumericPragma(dbPath, 'default_cache_size', { pagesSetTo: v => v, kilobytesSetTo: v => -v });
  pragma.deferForeignKeys = createBooleanPragma(dbPath, 'defer_foreign_keys');
  pragma.encoding = createEnumPragma(dbPath, 'encoding', {
    setToUTF8: ['"UTF-8"', Encoding.UTF8],
    setToUTF16le: ['"UTF-16le"', Encoding.UTF16LE],
    setToUTF16be: ['"UTF-16be"', Encoding.UTF16BE],
  }, Encoding.UTF8);
  pragma.foreignKeyCheck = createRunPragma(dbPath, 'foreign_key_check');
  pragma.foreignKeyList = createRunPragma(dbPath, 'foreign_key_list');
  pragma.foreignKey = createBooleanPragma(dbPath, 'foreign_keys');
  pragma.freelistCount = createRunPragma(dbPath, 'freelist_count');
  pragma.fullColumnNames = createBooleanPragma(dbPath, 'full_column_names');
  pragma.fullfsync = createBooleanPragma(dbPath, 'fullfsync');
  pragma.ignoreCheckConstraints = createBooleanPragma(dbPath, 'ignore_check_constraints');
  pragma.incrementalVacuum = createRunPragma(dbPath, 'incremental_vacuum');
  pragma.indexInfo = createRunPragma(dbPath, 'index_info');
  pragma.indexList = createRunPragma(dbPath, 'index_list');
  pragma.integrityCheck = createRunPragma(dbPath, 'integrity_check');
  pragma.journalMode = createEnumPragma(dbPath, 'journal_mode', {
    setToDelete: ['DELETE', JournalMode.DELETE],
    setToTruncate: ['TRUNCATE', JournalMode.TRUNCATE],
    setToPersist: ['PERSIST', JournalMode.PERSIST],
    setToMemory: ['MEMORY', JournalMode.MEMORY],
    setToWAL: ['WAL', JournalMode.WAL],
    setToOff: ['OFF', JournalMode.OFF],
  }, JournalMode.DELETE);
  pragma.journalSizeLimit = createNumericPragma(dbPath, 'journal_size_limit', 'bytesSetTo');
  pragma.legacyAlterTable = createBooleanPragma(dbPath, 'legacy_alter_table');
  pragma.lockingMode = createEnumPragma(dbPath, 'locking_mode', {
    setToNormal: ['NORMAL', LockingMode.NORMAL],
    setToExclusive: ['EXCLUSIVE', LockingMode.EXCLUSIVE],
  }, LockingMode.NORMAL);
  pragma.maxPageCount = createNumericPragma(dbPath, 'max_page_count', 'pagesSetTo');
  pragma.mmapSize = createNumericPragma(dbPath, 'mmap_size', 'bytesSetTo');
  pragma.moduleList = createRunPragma(dbPath, 'module_list');
  pragma.optimize = createRunPragma(dbPath, 'optimize');
  pragma.pageCount = createRunPragma(dbPath, 'page_count');
  pragma.pageSize = createNumericPragma(dbPath, 'page_size', 'bytesSetTo');
  pragma.pragmaList = createRunPragma(dbPath, 'pragma_list');
  pragma.queryOnly = createBooleanPragma(dbPath, 'query_only');
  pragma.quickCheck = createRunPragma(dbPath, 'quick_check');
  pragma.readUncommitted = createBooleanPragma(dbPath, 'read_uncommitted');
  pragma.recursiveTriggers = createBooleanPragma(dbPath, 'recursive_triggers');
  pragma.schemaVersion = createNumericPragma(dbPath, 'schema_version', 'numberSetTo');
  pragma.secureDelete = createBooleanPragma(dbPath, 'secure_delete');
  pragma.shortColumnNames = createBooleanPragma(dbPath, 'short_column_names');
  pragma.shrinkMemory = createRunPragma(dbPath, 'shrink_memory');
  pragma.stats = createRunPragma(dbPath, 'stats');
  pragma.synchronous = createEnumPragma(dbPath, 'synchronous', {
    setToOff: ['OFF', Synchronous.OFF],
    setToNormal: ['NORMAL', Synchronous.NORMAL],
    setToFull: ['FULL', Synchronous.FULL],
    setToExtra: ['EXTRA', Synchronous.EXTRA],
  }, Synchronous.FULL);
  pragma.tableInfo = createRunPragma(dbPath, 'table_info');
  pragma.tableList = createRunPragma(dbPath, 'table_list');
  pragma.tableXinfo = createRunPragma(dbPath, 'table_xinfo');
  pragma.tempStore = createEnumPragma(dbPath, 'temp_store', {
    setToDefault: ['DEFAULT', TempStore.DEFAULT],
    setToFile: ['FILE', TempStore.FILE],
    setToMemory: ['MEMORY', TempStore.MEMORY],
  }, TempStore.DEFAULT);
  pragma.threads = createNumericPragma(dbPath, 'threads', 'numberSetTo');
  pragma.trustedSchema = createBooleanPragma(dbPath, 'trusted_schema');
  pragma.userVersion = createNumericPragma(dbPath, 'user_version', 'numberSetTo');
  pragma.walAutocheckpoint = createNumericPragma(dbPath, 'wal_autocheckpoint', 'framesSetTo');
  pragma.walCheckpoint = createRunPragma(dbPath, 'wal_checkpoint');
  pragma.writableSchema = createBooleanPragma(dbPath, 'writable_schema');
  return pragma;
}

