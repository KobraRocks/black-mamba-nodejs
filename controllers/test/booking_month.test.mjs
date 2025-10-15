import test from 'node:test';
import assert from 'node:assert/strict';
import { Booking } from '../booking.js';

const pad = (value) => String(value).padStart(2, '0');

test('booking month keeps current day available when future slots exist', async (t) => {
  const fixedNow = Date.UTC(2025, 6, 10, 12, 0, 0); // 2025-07-10T12:00:00Z
  t.mock.method(Date, 'now', () => fixedNow);
  t.after(() => t.mock.restoreAll());

  const nowDate = new Date(fixedNow);
  const isoDate = `${nowDate.getUTCFullYear()}-${pad(nowDate.getUTCMonth() + 1)}-${pad(nowDate.getUTCDate())}`;
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const weekday = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();

  const user = { id: 1, email: 'owner@example.com', public_id: 'pub-1' };
  const eventType = {
    id: 2,
    user_id: user.id,
    slug: 'intro-call',
    name: 'Intro Call',
    duration_min: 30,
    tz_offset: '+00:00',
    availability_json: JSON.stringify({ [String(weekday)]: [['00:00', '23:30']] }),
    buffer_before_min: 0,
    buffer_after_min: 0,
    min_notice_min: 0,
    max_notice_days: 30,
  };

  const models = {
    user: { find_by: ({ public_id }) => (public_id === user.public_id ? user : null) },
    event_type: { find_by: ({ slug }) => (slug === eventType.slug ? eventType : null) },
    event_booking: { where: () => [] },
  };

  const originalModel = Booking.model;
  Booking.model = (key) => {
    if (models[key]) return models[key];
    return originalModel.call(Booking, key);
  };
  t.after(() => { Booking.model = originalModel; });

  const req = {
    params: { booker_public_id: user.public_id, slug: eventType.slug },
    url: new URL(`http://example.com/booking/${user.public_id}/${eventType.slug}?month=current`),
  };

  const result = Booking.page(req);
  assert.ok(result?._bm_view, 'expected render response');
  assert.equal(result.action, 'month');

  const data = result.assigns;
  assert.equal(Number(data.month), month);
  assert.equal(Number(data.year), year);
  const todayEntry = (Array.isArray(data.days) ? data.days : []).find((d) => Number(d.day) === day);
  assert.ok(todayEntry, 'expected current day entry');
  assert.equal(todayEntry.disabled, false, 'current day should remain enabled');
  assert.equal(todayEntry.available, true, 'current day should be marked available');
});
