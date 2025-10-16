import '../env/index.js';

function uniqueByKey(items = []) {
  const seen = new Set();
  const result = [];
  for (const entry of items) {
    if (!entry || typeof entry.key !== 'string') continue;
    const key = entry.key;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function normalizeRole(value, fallback) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw ? raw : fallback;
}

export function labelForRole(feature, role) {
  if (!feature || !Array.isArray(feature.roles)) return role;
  const found = feature.roles.find(option => option.key === role);
  return found ? found.label : role;
}

function bookingFeatureDefinition(getModel) {
  const lookup = typeof getModel === 'function' ? getModel : () => null;
  const BookingUser = lookup('booking_user') || lookup('BookingUser');
  if (!BookingUser) return null;
  const EventType = lookup('event_type') || lookup('EventType');
  const EventBooking = lookup('event_booking') || lookup('EventBooking');

  const statuses = BookingUser.statuses || {};
  const guest = normalizeRole(statuses.GUEST, 'guest');
  const booker = normalizeRole(statuses.BOOKER, 'booker');
  const admin = normalizeRole(statuses.ADMIN, 'admin');
  const allowedRoles = new Set([guest, booker, admin]);

  const roles = uniqueByKey([
    { key: guest, label: 'Guest' },
    { key: booker, label: 'Organizer' },
    { key: admin, label: 'Booking admin' },
  ]);

  const resolveRole = (value) => {
    const normalized = normalizeRole(value, guest);
    return allowedRoles.has(normalized) ? normalized : guest;
  };

  const collectAssignments = () => {
    const map = new Map();
    try {
      const records = BookingUser.all?.({ order: 'user_id ASC' }) || BookingUser.all?.() || [];
      for (const record of records) {
        const uid = Number(record?.user_id);
        if (!Number.isFinite(uid)) continue;
        const role = resolveRole(record?.status);
        map.set(uid, role);
      }
    } catch {}
    return map;
  };

  const applyRole = (userId, role) => {
    const normalized = resolveRole(role);
    try {
      let profile = BookingUser.find_by?.({ user_id: userId });
      if (!profile) {
        profile = BookingUser.create?.({ user_id: userId, status: normalized });
      } else {
        if (typeof profile.assign === 'function') profile.assign({ status: normalized });
        else profile.status = normalized;
        if (typeof profile.save === 'function') profile.save();
      }
      return normalized;
    } catch (err) {
      throw err;
    }
  };

  const collectMetrics = () => {
    let eventTypes = 0;
    let totalBookings = 0;
    try { eventTypes = EventType?.count?.() ?? eventTypes; } catch {}
    try { totalBookings = EventBooking?.count?.() ?? totalBookings; } catch {}
    return { eventTypes, totalBookings };
  };

  const describeForUser = ({ userId, sessionStatus }) => {
    let role = null;
    try {
      if (Number.isFinite(Number(userId))) {
        const profile = BookingUser.find_by?.({ user_id: Number(userId) });
        if (profile?.status) role = profile.status;
      }
    } catch {}
    if (!role && sessionStatus) role = sessionStatus;
    const normalized = resolveRole(role);
    const links = [
      { label: 'Bookings dashboard', url: '/event_bookings/management' },
    ];
    if (normalized === booker || normalized === admin) {
      links.push(
        { label: 'Event types', url: '/events/management' },
        { label: 'Booking pages', url: '/booking/management' },
      );
    }
    return { role: normalized, links };
  };

  return {
    key: 'booking',
    name: 'Booking',
    description: 'Manage scheduling, availability, and event bookings.',
    defaultRole: guest,
    roles,
    collectAssignments,
    applyRole,
    collectMetrics,
    describeForUser,
  };
}

export function featureDefinitions({ getModel } = {}) {
  const features = [];
  const booking = bookingFeatureDefinition(getModel);
  if (booking) features.push(booking);
  return features;
}

function normalizeLink(link) {
  if (!link || typeof link.url !== 'string') return null;
  const url = String(link.url);
  const label = typeof link.label === 'string' ? link.label : url;
  return { label, url };
}

export function featuresForUser({ userId, sessionStatus, getModel, definitions } = {}) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const defs = Array.isArray(definitions) ? definitions : featureDefinitions({ getModel });
  const features = [];
  for (const feature of defs) {
    if (!feature || typeof feature.describeForUser !== 'function') continue;
    let detail;
    try {
      detail = feature.describeForUser({ userId: uid, sessionStatus, getModel });
    } catch {
      detail = null;
    }
    if (!detail) continue;
    const role = normalizeRole(detail.role, feature.defaultRole);
    const normalizedRole = feature.roles?.some?.(r => r.key === role) ? role : feature.defaultRole;
    const links = Array.isArray(detail.links) ? detail.links.map(normalizeLink).filter(Boolean) : [];
    features.push({
      key: feature.key,
      name: feature.name,
      description: feature.description,
      role: normalizedRole,
      role_label: labelForRole(feature, normalizedRole),
      links,
    });
  }
  return features;
}

export default { featureDefinitions, featuresForUser, labelForRole };
