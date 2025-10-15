import { ApplicationRecord } from '../application.js';

const DEFAULT_STATUSES = Object.freeze({
  GUEST: 'guest',
  BOOKER: 'booker',
  ADMIN: 'admin',
});

export class BookingUser extends ApplicationRecord {
  static statuses = DEFAULT_STATUSES;

  validate() {
    const userId = Number(this.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      this.errors.add('user_id', "must reference a user");
    }

    const statuses = this.constructor.statuses;
    const allowed = new Set(Object.values(statuses));
    const rawStatus = String(this.status ?? '').trim().toLowerCase() || statuses.GUEST;
    if (!allowed.has(rawStatus)) {
      this.errors.add('status', 'is not included in the list');
    } else {
      this.status = rawStatus;
    }
  }
}

BookingUser.model = new ApplicationRecord.model.constructor({
  user_id: { type: 'integer', mandatory: true, reference: 'users(id)' },
  status: { type: 'string', mandatory: true, default: DEFAULT_STATUSES.GUEST },
});

BookingUser.migrate = function migrate() {
  const ok = ApplicationRecord.migrate.call(this);
  const db = this.database;
  try {
    db.execSync?.(`CREATE UNIQUE INDEX IF NOT EXISTS ${this.table}_user_id_idx ON ${this.table}(user_id);`);
  } catch {}

  const guest = this.statuses?.GUEST || DEFAULT_STATUSES.GUEST;
  try {
    db.execSync?.(`
      INSERT INTO ${this.table} (user_id, status, created_at, updated_at)
      SELECT u.id, '${guest}', datetime('now'), datetime('now')
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM ${this.table} bu WHERE bu.user_id = u.id
      );
    `);
  } catch {}

  try {
    db.execSync?.(`
      UPDATE ${this.table}
      SET status = '${guest}', updated_at = datetime('now')
      WHERE status IS NULL OR TRIM(status) = '';
    `);
  } catch {}

  return ok;
};
