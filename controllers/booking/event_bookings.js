import { ApplicationController } from '../application.js';
import { generateDailySlots } from '../../libs/booking/index.js';
import { hmacVerify, hmacSign } from '../../libs/session/crypto.js';

export const EventBookings = new class extends ApplicationController {
  namespace = 'booking';
  resources = 'event_bookings';
  routeRoot = '/event_bookings';
  constructor() {
    super();
    this.custom_routes.add(['GET', 'cancel', 'cancel']);
    this.custom_routes.add(['GET', 'management', 'management']);
  }

  index(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const ET = this.model('event_type');
    const owned = ET.where({ user_id: uid }).map(e => Number(e.id));
    const filterType = req.url.searchParams.get('event_type_id');
    const ids = new Set(owned);
    const EB = this.model('event_booking');
    const list = EB.all({ order: 'starts_at ASC' })
      .filter(b => ids.has(Number(b.event_type_id)) && (!filterType || Number(b.event_type_id) === Number(filterType)))
      .map(b => b.toJSON());
    return list;
  }

  async create(req, _res) {
    const body = await req.body();
    const event_type_id = Number(body?.event_type_id);
    const invitee_name = String(body?.invitee_name || '').trim();
    const invitee_email = String(body?.invitee_email || '').trim().toLowerCase();
    const start_iso = String(body?.start_iso || '').trim(); // UTC ISO start
    const time_zone = String(body?.time_zone || '');
    if (!event_type_id || !invitee_name || !invitee_email || !start_iso) {
      return { _bm_response: true, status: 422, json: { errors: ['missing fields'] } };
    }
    const EventType = this.model('event_type');
    const et = EventType.find(event_type_id);
    if (!et) return { _bm_response: true, status: 404, json: { error: 'event_type not found' } };

    const Booking = this.model('event_booking');
    const start = new Date(start_iso);
    const end = new Date(start.getTime() + et.duration_min * 60_000);

    // Validate that the requested start is still available for the organizer day
    const dateLocal = new Date(start.getTime());
    const yyyy = dateLocal.toISOString().slice(0,10); // approxi using UTC date as base
    let windows;
    try {
      const weekly = JSON.parse(et.availability_json || '{}') || {};
      const weekday = new Date(`${yyyy}T00:00:00.000Z`).getUTCDay();
      windows = weekly[String(weekday)] || weekly[String(((weekday + 6) % 7) + 1)] || [];
      if (!Array.isArray(windows)) windows = [];
    } catch { windows = []; }
    const existing = Booking.where({ event_type_id: et.id }).map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at }));
    const slots = generateDailySlots({
      date: yyyy,
      windows,
      durationMin: et.duration_min,
      intervalMin: et.duration_min,
      tzOffset: et.tz_offset || '+00:00',
      existingUtc: existing,
      bufferBeforeMin: et.buffer_before_min,
      bufferAfterMin: et.buffer_after_min,
      minNoticeMin: et.min_notice_min,
    });
    if (!slots.includes(start.toISOString())) {
      return { _bm_response: true, status: 409, json: { error: 'slot-unavailable' } };
    }

    const booking = new Booking({ event_type_id, invitee_name, invitee_email, starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'confirmed' });
    if (!booking.save()) return { _bm_response: true, status: 422, json: { errors: booking.errors.fullMessages() } };
    const secret = process.env.BM_SESSION_SECRET || 'dev-secret-change-me';
    const token = `${booking.id}.${hmacSign(String(booking.id), secret)}`;
    const payload = { ...booking.toJSON(), cancel_token: token };
    if (this.wants_json(req)) return { _bm_response: true, status: 201, json: payload };
    return this.render('success', payload);
  }

  async update(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const id = Number(req.params.id);
    const EB = this.model('event_booking');
    const et = this.model('event_type');
    const b = EB.find(id);
    if (!b) return { _bm_response: true, status: 404, json: { error: 'not found' } };
    const owner = et.find(b.event_type_id);
    if (!owner || owner.user_id !== uid) return { _bm_response: true, status: 403, json: { error: 'forbidden' } };
    const body = await req.body();
    if (body.start_iso) {
      const start = new Date(String(body.start_iso));
      const end = new Date(start.getTime() + owner.duration_min * 60_000);
      // verify availability
      const existing = EB.where({ event_type_id: owner.id }).filter(x => x.id !== b.id).map(x => ({ starts_at: x.starts_at, ends_at: x.ends_at }));
      const yyyy = start.toISOString().slice(0,10);
      let windows; try { const w = JSON.parse(owner.availability_json || '{}') || {}; const wd = new Date(`${yyyy}T00:00:00.000Z`).getUTCDay(); windows = w[String(wd)] || w[String(((wd+6)%7)+1)] || []; } catch { windows=[]; }
      const slots = generateDailySlots({ date: yyyy, windows, durationMin: owner.duration_min, intervalMin: owner.duration_min, tzOffset: owner.tz_offset || '+00:00', existingUtc: existing, bufferBeforeMin: owner.buffer_before_min, bufferAfterMin: owner.buffer_after_min, minNoticeMin: owner.min_notice_min, maxNoticeDays: owner.max_notice_days });
      if (!slots.includes(start.toISOString())) return { _bm_response: true, status: 409, json: { error: 'slot-unavailable' } };
      b.assign({ starts_at: start.toISOString(), ends_at: end.toISOString() });
    }
    if (body.status) b.assign({ status: String(body.status) });
    if (!b.save()) return { _bm_response: true, status: 422, json: { errors: b.errors.fullMessages() } };
    return b.toJSON();
  }

  destroy(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const id = Number(req.params.id);
    const EB = this.model('event_booking');
    const b = EB.find(id);
    if (!b) return { _bm_response: true, status: 404, json: { error: 'not found' } };
    const ET = this.model('event_type');
    const et = ET.find(b.event_type_id);
    if (!et || et.user_id !== uid) return { _bm_response: true, status: 403, json: { error: 'forbidden' } };
    b.destroy();
    return { _bm_response: true, status: 204 };
  }

  cancel(req, _res) {
    const token = req.url.searchParams.get('token') || '';
    if (!token) return { _bm_response: true, status: 400, text: 'missing token' };
    try {
      const [idStr, sig] = String(token).split('.');
      const id = Number(idStr);
      if (!id || !sig) return { _bm_response: true, status: 400, text: 'invalid token' };
      const secret = process.env.BM_SESSION_SECRET || 'dev-secret-change-me';
      if (!hmacVerify(idStr, sig, secret)) return { _bm_response: true, status: 403, text: 'invalid signature' };
      const EB = this.model('event_booking');
      const b = EB.find(id);
      if (!b) return { _bm_response: true, status: 404, text: 'not found' };
      b.assign({ status: 'canceled' });
      b.save();
      return this.render('cancelled', b.toJSON());
    } catch (e) {
      return { _bm_response: true, status: 400, text: 'invalid token' };
    }
  }

  management(req, _res) {
    const guard = this.ensureBooker(req);
    if (guard) return guard;
    const uid = req.session?.getUserId();
    const ET = this.model('event_type');
    const EB = this.model('event_booking');
    const events = ET.where({ user_id: uid });
    const eventMap = new Map(events.map(e => [Number(e.id), e]));
    const bookings = EB.all({ order: 'starts_at ASC' })
      .filter(b => eventMap.has(Number(b.event_type_id)))
      .map((b) => {
        const event = eventMap.get(Number(b.event_type_id));
        return {
          id: b.id,
          invitee_name: b.invitee_name,
          invitee_email: b.invitee_email,
          starts_at: b.starts_at,
          ends_at: b.ends_at,
          status: b.status,
          event: event ? event.toJSON?.() || event : null,
        };
      });

    return this.render('management', { bookings });
  }
}();
