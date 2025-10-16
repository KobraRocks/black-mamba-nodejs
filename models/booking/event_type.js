import { ApplicationRecord } from '../application.js';

export class EventType extends ApplicationRecord {}

EventType.model = new ApplicationRecord.model.constructor({
  user_id:           { type: 'integer', mandatory: true, reference: 'users(id)' },
  name:               { type: 'string',  mandatory: true },
  slug:               { type: 'string',  mandatory: true },
  duration_min:       { type: 'integer', mandatory: true },
  tz_offset:          { type: 'string',  default: '+00:00' },
  availability_json:  { type: 'text',    default: '{}' },
  buffer_before_min:  { type: 'integer', default: 0 },
  buffer_after_min:   { type: 'integer', default: 0 },
  min_notice_min:     { type: 'integer', default: 0 },
  max_notice_days:    { type: 'integer', default: 60 },
});

EventType.migrate = function migrate() {
  const ok = ApplicationRecord.migrate.call(this);
  try {
    const db = this.database;
    db.execSync?.(`CREATE UNIQUE INDEX IF NOT EXISTS idx_event_types_slug ON ${this.table}(slug);`);
  } catch {}
  return ok;
};
