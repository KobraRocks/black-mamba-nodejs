import '../libs/env/index.js';
import { ApplicationRecord } from './application.js';

export class WebauthnCredential extends ApplicationRecord {}

WebauthnCredential.model = new ApplicationRecord.model.constructor({
  user_id:        { type: 'integer', mandatory: true, reference: 'users(id)' },
  credential_id:  { type: 'string',  mandatory: true },
  public_key:     { type: 'text',    mandatory: true },
  sign_count:     { type: 'integer', default: 0 },
  transports:     { type: 'string',  default: '' },
});

// Ensure indexes (best-effort)
WebauthnCredential.migrate = function migrate() {
  const ok = ApplicationRecord.migrate.call(this);
  const db = this.database;
  db.execSync?.(`CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_cred_id ON ${this.table}(credential_id);`);
  db.execSync?.(`CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON ${this.table}(user_id);`);
  return ok;
};
