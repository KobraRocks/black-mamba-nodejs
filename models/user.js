import '../libs/env/index.js';
import crypto from 'node:crypto';
import { ApplicationRecord } from './application.js';

export class User extends ApplicationRecord {
  // resources inferred as 'users' from class name
  static migrate() {
    // base table
    super.migrate();
    // Add missing column when upgrading existing databases
    const db = this.database;
    try {
      const pragma = db.allSync?.(`PRAGMA table_info(${this.table})`) || db.all(`PRAGMA table_info(${this.table})`);
      const hasPublicId = Array.isArray(pragma) && pragma.some(col => col.name === 'public_id');
      if (!hasPublicId) {
        db.execSync?.(`ALTER TABLE ${this.table} ADD COLUMN public_id TEXT`);
      }
    } catch {}
    // unique indices
    db.execSync?.(`CREATE UNIQUE INDEX IF NOT EXISTS ${this.table}_email_idx ON ${this.table}(email)`);
    db.execSync?.(`CREATE UNIQUE INDEX IF NOT EXISTS ${this.table}_public_idx ON ${this.table}(public_id)`);
    // Ensure legacy rows receive a public id
    try {
      db.execSync?.(`UPDATE ${this.table} SET public_id = substr(hex(randomblob(16)),1,32) WHERE public_id IS NULL OR public_id = ''`);
    } catch {}
  }

  validate() {
    // Presence is already handled by mandatory=true, add uniqueness check
    const email = String(this.email || '').trim().toLowerCase();
    if (email) {
      const existing = this.constructor.find_by({ email });
      if (existing && existing.id !== this.id) {
        this.errors.add('email', "has already been taken");
      }
    }

    if (!this.public_id) {
      this.public_id = crypto.randomUUID();
    }
    const publicId = String(this.public_id || '').trim();
    if (!publicId) {
      this.errors.add('public_id', "can't be blank");
    } else {
      const existingPublic = this.constructor.find_by({ public_id: publicId });
      if (existingPublic && existingPublic.id !== this.id) {
        this.errors.add('public_id', "has already been taken");
      }
    }
  }
}

// Define schema for the model
User.model = new ApplicationRecord.model.constructor({
  email: { type: 'string', mandatory: true },
  public_id: { type: 'string', mandatory: false },
});

// Consumers should call `User.migrate()` at bootstrapping time to ensure table exists.
