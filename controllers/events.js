import { ApplicationController } from './application.js';
import { generateDailySlots } from '../libs/booking/index.js';
import { utcToLocal } from '../libs/timezone/index.js';

export const Events = new class extends ApplicationController {
  resources = 'events';

  constructor() {
    super();
    this.custom_routes.add(['GET', 'slots', ':id/slots']);
    this.custom_routes.add(['GET', 'show_slug', 's/:slug']);
    this.custom_routes.add(['GET', 'slots_slug', 's/:slug/slots']);
    // Allow HTML forms to POST updates without PUT support
    this.custom_routes.add(['POST', 'update', ':id/edit']);
  }

  index(req, _res) {
    const mine = req.url.searchParams.get('mine');
    const ET = this.model('event_type');
    if (mine && req.session?.getUserId()) {
      return ET.where({ user_id: req.session.getUserId() }).map(e => e.toJSON());
    }
    return ET.all({ order: 'id ASC' }).map(e => e.toJSON());
  }

  show(req, _res) {
    const id = Number(req.params.id);
    const et = this.model('event_type').find(id);
    if (!et) return { _bm_response: true, status: 404, json: { error: 'EventType not found' } };
    return et.toJSON();
  }

  show_slug(req, _res) {
    const slug = String(req.params.slug || '');
    const ET = this.model('event_type');
    const et = ET.find_by({ slug });
    if (!et) return { _bm_response: true, status: 404, json: { error: 'EventType not found' } };
    return et.toJSON();
  }

  slots(req, _res) {
    const id = Number(req.params.id);
    const et = this.model('event_type').find(id);
    if (!et) return { _bm_response: true, status: 404, json: { error: 'EventType not found' } };
    const date = req.url.searchParams.get('date'); // YYYY-MM-DD in organizer local
    const tzOffset = req.url.searchParams.get('tz_offset') || et.tz_offset || '+00:00';
    const timeZone = req.url.searchParams.get('timeZone') || '';
    if (!date) return { _bm_response: true, status: 400, json: { error: 'date required (YYYY-MM-DD)' } };
    let windows;
    try {
      const weekly = JSON.parse(et.availability_json || '{}') || {};
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      // Map JS weekday (0..6, Sun..Sat) to keys 0..6
      windows = weekly[String(weekday)] || weekly[String(((weekday + 6) % 7) + 1)] || []; // support 1..7 as well
      if (!Array.isArray(windows)) windows = [];
    } catch { windows = []; }
    const Booking = this.model('event_booking');
    const existing = Booking.where({ event_type_id: et.id }).map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at }));
    const slots = generateDailySlots({
      date,
      windows,
      durationMin: et.duration_min,
      intervalMin: et.duration_min,
      tzOffset,
      existingUtc: existing,
      bufferBeforeMin: et.buffer_before_min,
      bufferAfterMin: et.buffer_after_min,
      minNoticeMin: et.min_notice_min,
      maxNoticeDays: et.max_notice_days,
    });
    if (timeZone) {
      const mapped = slots.map((utc) => {
        try {
          const p = utcToLocal(new Date(utc), timeZone);
          const local = `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:${String(p.second).padStart(2,'0')}`;
          return { utc, local };
        } catch { return { utc, local: null }; }
      });
      return { slots: mapped, timeZone };
    }
    return { slots };
  }

  slots_slug(req, _res) {
    const slug = String(req.params.slug || '');
    const ET = this.model('event_type');
    const et = ET.find_by({ slug });
    if (!et) return { _bm_response: true, status: 404, json: { error: 'EventType not found' } };
    // reuse slots
    req.params.id = String(et.id);
    return this.slots(req, _res);
  }

  async create(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const body = await req.body();
    let availability_json = body?.availability_json;
    if (typeof availability_json !== 'string') availability_json = JSON.stringify(availability_json || {});
    const attrs = {
      user_id: uid,
      name: String(body?.name || '').trim(),
      slug: String(body?.slug || '').trim(),
      duration_min: Number(body?.duration_min || 30),
      tz_offset: String(body?.tz_offset || '+00:00'),
      availability_json,
      buffer_before_min: Number(body?.buffer_before_min || 0),
      buffer_after_min: Number(body?.buffer_after_min || 0),
      min_notice_min: Number(body?.min_notice_min || 0),
      max_notice_days: Number(body?.max_notice_days || 60),
    };
    const ET = this.EventType || this.model('event_type');
    // Prefer static create to avoid constructor mismatches
    const et = ET?.create ? ET.create(attrs) : new ET(attrs);
    if (!et || et.errors?.any?.()) {
      return { _bm_response: true, status: 422, json: { errors: et?.errors?.fullMessages?.() || ['invalid'] } };
    }
    return { _bm_response: true, status: 201, json: et.toJSON() };
  }

  async update(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const id = Number(req.params.id);
    const ET = this.model('event_type');
    const et = ET.find(id);
    if (!et || et.user_id !== uid) {
      return { _bm_response: true, status: 404, json: { error: 'not found' } };
    }
    const body = await req.body();
    const patch = { ...body };
    if (patch.availability_json && typeof patch.availability_json !== 'string') patch.availability_json = JSON.stringify(patch.availability_json);
    et.assign(patch);
    if (!et.save()) {
      return { _bm_response: true, status: 422, json: { errors: et.errors.fullMessages() } };
    }
    return et.toJSON();
  }

  destroy(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const id = Number(req.params.id);
    const ET = this.model('event_type');
    const et = ET.find(id);
    if (!et || et.user_id !== uid) {
      return { _bm_response: true, status: 404, json: { error: 'not found' } };
    }
    et.destroy();
    return { _bm_response: true, status: 204 };
  }

  // HTML views
  new(_req, _res) { /* auto-render views/events/new.js */ }
  edit(req, _res) {
    const id = Number(req.params.id);
    const et = this.model('event_type').find(id);
    if (!et) return { _bm_response: true, status: 404, text: 'Not Found' };
    return { event: et.toJSON() };
  }
}();
