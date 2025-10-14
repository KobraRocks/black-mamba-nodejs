import { ApplicationRecord } from './application.js';
import { openSync as openDatabase } from "../libs/sqlite/index.mjs";

export class User extends ApplicationRecord {
  // resources inferred as 'users' from class name
  static migrate() {
    // base table
    super.migrate();
    // unique index on email as per simulation/data_models.md
    const db = openDatabase(process.env.BM_DATABASE || process.env.BM_SESSION_DB || ':memory:');
    db.execSync(`CREATE UNIQUE INDEX IF NOT EXISTS ${this.table}_email_idx ON ${this.table}(email)`);
  }

  validate() {
    // Presence is already handled by mandatory=true, add uniqueness check
    const email = String(this.email || '').trim().toLowerCase();
    if (!email) return; // mandatory will add error
    const existing = this.constructor.find_by({ email });
    if (existing && existing.id !== this.id) {
      this.errors.add('email', "has already been taken");
    }
  }
}

// Define schema for the model
User.model = new ApplicationRecord.model.constructor({
  email: { type: 'string', mandatory: true },
});

// Consumers should call `User.migrate()` at bootstrapping time to ensure table exists.
