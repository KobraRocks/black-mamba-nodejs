export const SqliteResult = {
  ERROR: Symbol('SQLITE_ERROR'),
  CONSTRAINT: Symbol('SQLITE_CONSTRAINT'),
  ROW: Symbol('SQLITE_ROW'),
  DONE: Symbol('SQLITE_DONE')
};

export class SqliteError extends Error {
  constructor(message, code = SqliteResult.ERROR, cause) {
    super(message, { cause });
    this.name = 'SqliteError';
    this.code = code;
  }
}

export function isSqliteConstraint(value) {
  if (value instanceof SqliteError) return value.code === SqliteResult.CONSTRAINT;
  if (typeof value === 'number') return value === 19;
  return false;
}

