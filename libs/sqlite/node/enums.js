export const AutoVacuum = Object.freeze({ NONE: Symbol('NONE'), FULL: Symbol('FULL'), INCREMENTAL: Symbol('INCREMENTAL') });
export const JournalMode = Object.freeze({ DELETE: Symbol('DELETE'), TRUNCATE: Symbol('TRUNCATE'), PERSIST: Symbol('PERSIST'), MEMORY: Symbol('MEMORY'), WAL: Symbol('WAL'), OFF: Symbol('OFF') });
export const Synchronous = Object.freeze({ OFF: Symbol('OFF'), NORMAL: Symbol('NORMAL'), FULL: Symbol('FULL'), EXTRA: Symbol('EXTRA') });
export const LockingMode = Object.freeze({ NORMAL: Symbol('NORMAL'), EXCLUSIVE: Symbol('EXCLUSIVE') });
export const TempStore = Object.freeze({ DEFAULT: Symbol('DEFAULT'), FILE: Symbol('FILE'), MEMORY: Symbol('MEMORY') });
export const Encoding = Object.freeze({ UTF8: Symbol('UTF-8'), UTF16LE: Symbol('UTF-16le'), UTF16BE: Symbol('UTF-16be') });
export const RecordMode = Object.freeze({ FIRST: Symbol('FIRST'), ALL: Symbol('ALL') });
export const Iterator = Object.freeze({ SET: Symbol('SET'), ARRAY: Symbol('ARRAY') });

