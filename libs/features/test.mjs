import test from 'node:test';
import assert from 'node:assert/strict';
import { featureDefinitions, featuresForUser, labelForRole } from './index.js';

class FakeBookingUser {
  static statuses = { GUEST: 'guest', BOOKER: 'booker', ADMIN: 'admin' };
  static #records = new Map();

  constructor({ user_id, status }) {
    this.user_id = Number(user_id);
    this.status = String(status);
  }

  assign(attrs = {}) {
    if (Object.prototype.hasOwnProperty.call(attrs, 'status')) this.status = attrs.status;
  }

  save() {
    FakeBookingUser.#records.set(this.user_id, this);
    return true;
  }

  static reset() {
    FakeBookingUser.#records.clear();
  }

  static create(attrs = {}) {
    const record = new FakeBookingUser({ user_id: attrs.user_id, status: attrs.status ?? this.statuses.GUEST });
    this.#records.set(record.user_id, record);
    return record;
  }

  static find_by(query = {}) {
    const uid = Number(query.user_id);
    return this.#records.get(uid) || null;
  }

  static all() {
    return Array.from(this.#records.values()).sort((a, b) => a.user_id - b.user_id);
  }
}

class FakeEventType {
  static count() { return 5; }
}

class FakeEventBooking {
  static count() { return 12; }
}

test('feature definitions expose booking feature', () => {
  FakeBookingUser.reset();
  const defs = featureDefinitions({ getModel: (key) => {
    switch (key) {
      case 'booking_user': return FakeBookingUser;
      case 'event_type': return FakeEventType;
      case 'event_booking': return FakeEventBooking;
      default: return undefined;
    }
  } });
  assert.equal(defs.length, 1);
  const booking = defs[0];
  assert.equal(booking.key, 'booking');
  assert.equal(labelForRole(booking, 'booker'), 'Organizer');
  const assignments = booking.collectAssignments();
  assert.equal(assignments instanceof Map, true);
});

test('featuresForUser returns guest booking feature with dashboard link', () => {
  FakeBookingUser.reset();
  const getModel = (key) => {
    switch (key) {
      case 'booking_user': return FakeBookingUser;
      case 'event_type': return FakeEventType;
      case 'event_booking': return FakeEventBooking;
      default: return undefined;
    }
  };
  const defs = featureDefinitions({ getModel });
  const features = featuresForUser({ userId: 1, sessionStatus: 'guest', getModel, definitions: defs });
  assert.equal(features.length, 1);
  const booking = features[0];
  assert.equal(booking.role, 'guest');
  const urls = booking.links.map(link => link.url);
  assert.ok(urls.includes('/event_bookings/management'));
  assert.equal(urls.includes('/events/management'), false);
});

test('featuresForUser upgrades links for booker role', () => {
  FakeBookingUser.reset();
  FakeBookingUser.create({ user_id: 2, status: 'booker' });
  const getModel = (key) => {
    switch (key) {
      case 'booking_user': return FakeBookingUser;
      case 'event_type': return FakeEventType;
      case 'event_booking': return FakeEventBooking;
      default: return undefined;
    }
  };
  const defs = featureDefinitions({ getModel });
  const features = featuresForUser({ userId: 2, sessionStatus: 'booker', getModel, definitions: defs });
  assert.equal(features.length, 1);
  const booking = features[0];
  const urls = booking.links.map(link => link.url);
  assert.ok(urls.includes('/event_bookings/management'));
  assert.ok(urls.includes('/events/management'));
  assert.ok(urls.includes('/booking/management'));
  assert.equal(booking.role, 'booker');
});
