import { ApplicationRecord } from '../application.js';
import { normalizeDate } from '../../libs/booking/index.js';

export class EventBooking extends ApplicationRecord {
  validate() {
    const email = String(this.invitee_email || '').trim();
    if (!email.includes('@')) this.errors.add('invitee_email', 'is invalid');
    try {
      const s = normalizeDate(this.starts_at);
      const e = normalizeDate(this.ends_at);
      if (!(s.getTime() < e.getTime())) this.errors.add('ends_at', 'must be after starts_at');
    } catch (e) {
      this.errors.add('starts_at', 'or ends_at invalid');
    }
  }
}

EventBooking.model = new ApplicationRecord.model.constructor({
  event_type_id: { type: 'integer', mandatory: true, reference: 'event_types(id)' },
  invitee_name:  { type: 'string',  mandatory: true },
  invitee_email: { type: 'string',  mandatory: true },
  starts_at:     { type: 'date',    mandatory: true },
  ends_at:       { type: 'date',    mandatory: true },
  status:        { type: 'string',  default: 'confirmed' },
});

EventBooking.migrate = function migrate() {
  const ok = ApplicationRecord.migrate.call(this);
  try {
    const db = this.database;
    db.execSync?.(`CREATE INDEX IF NOT EXISTS idx_event_bookings_type ON ${this.table}(event_type_id);`);
    db.execSync?.(`CREATE INDEX IF NOT EXISTS idx_event_bookings_time ON ${this.table}(starts_at, ends_at);`);
  } catch {}
  return ok;
};
