import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOffset, toUtc, fromUtc, generateDailySlots, hasConflict, overlaps } from './index.js';

test('parseOffset + toUtc/fromUtc roundtrip', () => {
  assert.equal(parseOffset('+02:30'), 150);
  const local = new Date('2025-01-01T09:00:00.000Z');
  const utc = toUtc(local, '+02:00');
  const back = fromUtc(utc, '+02:00');
  assert.equal(back.toISOString(), local.toISOString());
});

test('generateDailySlots respects windows, duration, interval, buffers, and min notice', () => {
  const tz = '+00:00';
  const windows = [["09:00","10:00"]];
  const base = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // ~10 days in future
  const date = base.toISOString().slice(0,10);
  const existing = [
    { starts_at: `${date}T09:15:00.000Z`, ends_at: `${date}T09:30:00.000Z` },
  ];
  const slots = generateDailySlots({ date, windows, durationMin: 15, intervalMin: 15, tzOffset: tz, existingUtc: existing, bufferBeforeMin: 0, bufferAfterMin: 0, minNoticeMin: 0 });
  assert.equal(slots.includes(`${date}T09:00:00.000Z`), true);
  assert.equal(slots.includes(`${date}T09:15:00.000Z`), false);
  assert.equal(slots.includes(`${date}T09:30:00.000Z`), true);
  assert.equal(slots.includes(`${date}T09:45:00.000Z`), true);
});

test('hasConflict applies buffers', () => {
  const existing = [{ starts_at: '2025-06-01T10:00:00.000Z', ends_at: '2025-06-01T10:30:00.000Z' }];
  const start = new Date('2025-06-01T10:31:00.000Z');
  const end   = new Date('2025-06-01T10:46:00.000Z');
  assert.equal(hasConflict(existing, start, end, 0, 0), false);
  assert.equal(hasConflict(existing, start, end, 0, 2), true); // require 2 min after existing event
});
