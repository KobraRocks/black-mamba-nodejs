import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-booking-user-'));
const DB_PATH = path.join(tmpDir, 'booking_user.test.db');
process.env.BM_DATABASE = DB_PATH;

const { User } = await import('../user.js');
const { BookingUser } = await import('../booking/user.js');

User.migrate();

const alice = User.create({ email: 'alice@example.com' });
BookingUser.migrate();

test('migration backfills guest profile for existing users', () => {
  const profile = BookingUser.find_by({ user_id: alice.id });
  assert.ok(profile, 'booking profile should exist');
  assert.equal(profile.status, BookingUser.statuses.GUEST);
});

test('status is normalized and validated', () => {
  const bob = User.create({ email: 'bob@example.com' });
  const record = new BookingUser({ user_id: bob.id, status: 'ADMIN' });
  assert.equal(record.save(), true);
  assert.equal(record.status, BookingUser.statuses.ADMIN);

  const invalid = new BookingUser({ user_id: bob.id, status: 'unknown' });
  assert.equal(invalid.save(), false);
  const errors = invalid.errors.on('status');
  assert.ok(Array.isArray(errors) && errors.length > 0);
});

