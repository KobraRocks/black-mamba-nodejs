import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetAt, utcToLocal, localToUtc } from './index.js';

function supports(zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

test('UTC has zero-ish offset and roundtrip works', () => {
  const now = new Date('2025-01-01T12:00:00.000Z');
  assert.equal(offsetAt(now, 'UTC'), 0);
  const parts = utcToLocal(now, 'UTC');
  const back = localToUtc(parts, 'UTC');
  assert.equal(back.toISOString(), now.toISOString());
});

test('Europe/Paris roundtrip (if supported)', () => {
  if (!supports('Europe/Paris')) return; // skip
  const utc = new Date('2025-03-15T08:30:00.000Z');
  const parts = utcToLocal(utc, 'Europe/Paris');
  const back = localToUtc(parts, 'Europe/Paris');
  // Allow small drift if ICU data varies, but generally exact
  assert.equal(back.toISOString(), utc.toISOString());
});

