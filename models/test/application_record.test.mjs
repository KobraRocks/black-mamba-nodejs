import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Use a dedicated temporary DB per test file to avoid interference
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-models-'));
const DB_PATH = path.join(tmpDir, 'models.test.db');
process.env.BM_DATABASE = DB_PATH;

const m = await import('../application.js');
const { ApplicationRecord } = m;
const { openSync } = await import('../../libs/sqlite/index.mjs');
const Model = ApplicationRecord.model.constructor;

class Book extends ApplicationRecord {}
Book.model = new Model({
  title: { type: 'string', mandatory: true },
  pages: { type: 'integer', default: 0 },
  published_at: { type: 'date' },
});

class Author extends ApplicationRecord {}
class AdminUser extends ApplicationRecord { static namespace = 'auth'; }

test('table name derivation (Railsy)', () => {
  assert.equal(Author.table, 'authors');
  assert.equal(AdminUser.table, 'auth_admin_users');
});

test('migrate creates table and basic CRUD works', () => {
  assert.equal(Book.migrate(), true);

  // invalid: missing mandatory title
  const b1 = new Book({ pages: 3 });
  assert.equal(b1.save(), false);
  assert.deepEqual(b1.errors.on('title'), ["can't be blank"]);
  assert.throws(() => b1["save!"](), /title can't be blank/);

  // valid create
  const b2 = Book.create({ title: 'Dune', pages: '412' }); // coercion from string
  assert.ok(b2.id > 0);
  assert.equal(typeof b2.created_at, 'string');
  assert.equal(typeof b2.updated_at, 'string');
  assert.equal(b2.pages, 412);

  // finders
  assert.equal(Book.count(), 1);
  assert.equal(Book.first().id, b2.id);
  assert.equal(Book.last().id, b2.id);
  assert.equal(Book.find(b2.id).id, b2.id);
  assert.equal(Book.find_by({ title: 'Dune' }).id, b2.id);
  assert.equal(Book.where({ title: 'Dune' }).length, 1);

  // update + timestamps
  const before = b2.updated_at;
  const ok = b2.update({ pages: 420 });
  assert.equal(ok, true);
  assert.equal(b2.pages, 420);
  assert.notEqual(b2.updated_at, before);
  assert.equal(b2.persisted(), true);
  assert.equal(b2.isNewRecord(), false);

  // reload
  const again = Book.find(b2.id);
  assert.equal(again.pages, 420);
  b2.assign({ pages: 421 });
  b2.reload();
  assert.equal(b2.pages, 420);

  // destroy
  const res = b2.destroy();
  assert.ok(res);
  assert.equal(Book.find(b2.id), null);
});

test('create! and update! raise on invalid', () => {
  assert.throws(() => Book["create!"]({ pages: 1 }), /title can't be blank/);

  const b = Book.create({ title: 'OK' });
  assert.doesNotThrow(() => b["update!"]({ pages: 2 }));
});

test('where, order, limit, offset', () => {
  // seed
  Book.create({ title: 'A', pages: 10 });
  Book.create({ title: 'B', pages: 20 });
  Book.create({ title: 'C', pages: 30 });

  const allAsc = Book.order('id ASC');
  const allDesc = Book.order('id DESC');
  assert.equal(allAsc.length >= 3, true);
  assert.equal(allAsc[0].id, allDesc.at(-1).id);

  const whereRes = Book.where({ pages: 20 });
  assert.equal(whereRes.length, 1);
  assert.equal(whereRes[0].title, 'B');

  const limited = Book.all({ order: 'id ASC', limit: 2 });
  assert.equal(limited.length, 2);

  const offset = Book.all({ order: 'id ASC', limit: 1, offset: 1 });
  assert.equal(offset.length, 1);
});

test('schema columns and types via PRAGMA', () => {
  // Ensure schema reflects model definitions
  const db = openSync(process.env.BM_DATABASE);
  const rows = db.allSync(`PRAGMA table_info(${Book.table})`);
  const col = name => rows.find(r => r.name === name);
  assert.ok(col('id'));
  assert.ok(col('created_at'));
  assert.ok(col('updated_at'));
  assert.ok(col('title'));
  assert.ok(col('pages'));
  assert.ok(col('published_at'));

  assert.equal(col('id').type.toUpperCase(), 'INTEGER');
  assert.equal(col('created_at').type.toUpperCase(), 'TEXT');
  assert.equal(col('updated_at').type.toUpperCase(), 'TEXT');
  assert.equal(col('title').type.toUpperCase(), 'TEXT');
  assert.equal(col('pages').type.toUpperCase(), 'INTEGER');
  assert.equal(col('published_at').type.toUpperCase(), 'TEXT');

  // notnull flags
  const nn = (v) => Number(v);
  assert.equal(nn(col('created_at').notnull), 1);
  assert.equal(nn(col('updated_at').notnull), 1);
  assert.equal(nn(col('title').notnull), 1);
  assert.equal(nn(col('pages').notnull), 0);
});
