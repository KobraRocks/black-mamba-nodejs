import test from 'node:test';
import assert from 'node:assert/strict';
import { Me } from '../me.js';

const originalUserModel = Me.User;
const originalBookingModel = Me.BookingUser;
const originalEventType = Me.EventType;
const originalEventBooking = Me.EventBooking;

function restoreModels() {
  Me.User = originalUserModel;
  Me.BookingUser = originalBookingModel;
  Me.EventType = originalEventType;
  Me.EventBooking = originalEventBooking;
}

test('me#index includes booking dashboard link for guest', (t) => {
  t.after(restoreModels);

  const user = { id: 1, email: 'guest@example.com', public_id: 'pub-1' };
  Me.User = { find: (id) => (id === 1 ? user : null) };
  Me.BookingUser = {
    statuses: { GUEST: 'guest', BOOKER: 'booker', ADMIN: 'admin' },
    find_by: ({ user_id }) => (user_id === 1 ? { status: 'guest' } : null),
  };
  Me.EventType = { count: () => 0 };
  Me.EventBooking = { count: () => 0 };

  const req = {
    session: {
      getUserId: () => 1,
      getUserStatus: () => 'guest',
      get: () => false,
    },
  };

  const payload = Me.index(req);
  assert.equal(payload.email, user.email);
  assert.equal(Array.isArray(payload.features), true);
  const booking = payload.features.find((f) => f.key === 'booking');
  assert.ok(booking, 'booking feature present');
  const urls = booking.links.map((link) => link.url);
  assert.ok(urls.includes('/event_bookings/management'));
  assert.equal(urls.includes('/events/management'), false);
});

test('me#index promotes booker links when status upgraded', (t) => {
  t.after(restoreModels);

  const user = { id: 2, email: 'owner@example.com', public_id: 'pub-2' };
  Me.User = { find: (id) => (id === 2 ? user : null) };
  Me.BookingUser = {
    statuses: { GUEST: 'guest', BOOKER: 'booker', ADMIN: 'admin' },
    find_by: ({ user_id }) => (user_id === 2 ? { status: 'booker' } : null),
  };
  Me.EventType = { count: () => 0 };
  Me.EventBooking = { count: () => 0 };

  const req = {
    session: {
      getUserId: () => 2,
      getUserStatus: () => 'booker',
      get: () => false,
    },
  };

  const payload = Me.index(req);
  const booking = payload.features.find((f) => f.key === 'booking');
  const urls = booking.links.map((link) => link.url);
  assert.ok(urls.includes('/event_bookings/management'));
  assert.ok(urls.includes('/events/management'));
  assert.ok(urls.includes('/booking/management'));
  assert.equal(booking.role, 'booker');
});
