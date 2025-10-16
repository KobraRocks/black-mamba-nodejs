import { ApplicationController } from '../application.js';
import { generateDailySlots, fromUtc } from '../../libs/booking/index.js';
import { sendMail } from '../../libs/smtp/index.js';

const MONTHS = [
  'January','February','March','April','May','June','July','August','September','October','November','December'
];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function clampOffset(value = '+00:00') {
  const m = String(value).match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return '+00:00';
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return '+00:00';
  if (hours > 14 || minutes > 59) return '+00:00';
  return `${m[1]}${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function humanizeEmailName(email = '') {
  const local = String(email).split('@')[0] || '';
  if (!local) return 'Organizer';
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatUtc(iso) {
  return new Date(iso);
}

function formatIcsDate(date) {
  const iso = new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return iso.endsWith('Z') ? iso : `${iso}Z`;
}

function icsEscape(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

async function deliver(message) {
  try {
    if (!process.env.BM_SMTP_HOST) {
      console.warn('[booking] SMTP host not configured, skipping email delivery');
      console.warn('[booking] message preview to %s', message.to);
      console.warn(message.text);
      return { ok: false, skipped: true };
    }
    const result = await sendMail(message);
    if (result?.error) throw result.error;
    return { ok: true };
  } catch (err) {
    console.error('[booking] email delivery failed for %s: %s', message.to, err?.message || err);
    return { ok: false, error: err };
  }
}

export const Booking = new class extends ApplicationController {
  namespace = 'booking';
  resources = 'booking';
  routeRoot = '/booking';

  constructor() {
    super();
    this.custom_routes.add(['GET', 'page', ':booker_public_id/:slug']);
    this.custom_routes.add(['GET', 'contact', ':booker_public_id/:slug/contact']);
    this.custom_routes.add(['POST', 'submit', ':booker_public_id/:slug/contact']);
    this.custom_routes.add(['GET', 'management', 'management']);
  }

  #requireBookerSession(req) {
    const guard = this.ensureBooker(req);
    if (guard) return { error: guard };

    const uid = req.session?.getUserId();

    const User = this.model('user');
    const EventType = this.model('event_type');
    if (!User || !EventType) {
      return { error: { _bm_response: true, status: 500, text: 'Booking models unavailable' } };
    }

    const booker = User.find(uid);
    if (!booker) {
      return { error: { _bm_response: true, status: 403, text: 'Booker not found' } };
    }

    const eventTypes = EventType.where({ user_id: uid }).map(e => e.toJSON());

    return { booker: booker.toJSON ? booker.toJSON() : { ...booker }, eventTypes };
  }

  management(req, _res) {
    const ctx = this.#requireBookerSession(req);
    if (ctx?.error) return ctx.error;

    return this.render('management', {
      booker: ctx.booker,
      eventTypes: ctx.eventTypes,
      eventsUrl: '/booking/events/management',
      bookingsUrl: '/booking/event_bookings/management',
    });
  }

  #context(req) {
    const publicId = String(req.params.booker_public_id || '').trim();
    const slug = String(req.params.slug || '').trim();
    if (!publicId || !slug) {
      return { error: { _bm_response: true, status: 404, text: 'Booking page not found' } };
    }

    const User = this.model('user');
    const EventType = this.model('event_type');
    const EventBooking = this.model('event_booking');

    const booker = User?.find_by?.({ public_id: publicId });
    if (!booker) {
      return { error: { _bm_response: true, status: 404, text: 'Booker not found' } };
    }

    const eventType = EventType?.find_by?.({ slug });
    if (!eventType || Number(eventType.user_id) !== Number(booker.id)) {
      return { error: { _bm_response: true, status: 404, text: 'Event type not found' } };
    }

    let availability = {};
    try {
      const parsed = JSON.parse(eventType.availability_json || '{}');
      if (parsed && typeof parsed === 'object') availability = parsed;
    } catch {}

    const bookings = EventBooking?.where?.({ event_type_id: eventType.id }) || [];
    const offset = clampOffset(eventType.tz_offset || '+00:00');
    const basePath = `/booking/${encodeURIComponent(publicId)}/${encodeURIComponent(eventType.slug)}`;

    const windowsForWeekday = (weekday) => {
      const exact = availability[String(weekday)];
      if (Array.isArray(exact)) return exact;
      const alt = availability[String(((weekday + 6) % 7) + 1)];
      return Array.isArray(alt) ? alt : [];
    };

    return {
      booker,
      eventType,
      availability,
      windowsForWeekday,
      bookings,
      offset,
      basePath,
      organizerName: humanizeEmailName(booker.email),
    };
  }

  page(req, _res) {
    const ctx = this.#context(req);
    if (ctx.error) return ctx.error;

    const monthParam = req.url.searchParams.get('month');
    const dayParam = req.url.searchParams.get('day');
    const yearParam = req.url.searchParams.get('year');

    if (monthParam) {
      if (dayParam) {
        const data = this.#buildDay(ctx, { monthParam, dayParam, yearParam });
        if (data.error) return data.error;
        return this.render('day', data);
      }
      const data = this.#buildMonth(ctx, { monthParam, yearParam });
      if (data.error) return data.error;
      return this.render('month', data);
    }

    return this.render('page', this.#buildPage(ctx));
  }

  contact(req, _res) {
    const ctx = this.#context(req);
    if (ctx.error) return ctx.error;

    const params = {
      monthParam: req.url.searchParams.get('month'),
      dayParam: req.url.searchParams.get('day'),
      yearParam: req.url.searchParams.get('year'),
      startParam: req.url.searchParams.get('start'),
    };

    const data = this.#buildContact(ctx, params);
    if (data.error) return data.error;
    return this.render('contact', data);
  }

  async submit(req, _res) {
    const ctx = this.#context(req);
    if (ctx.error) return ctx.error;

    const body = await req.body();
    const first = String(body?.first_name || '').trim();
    const last = String(body?.last_name || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const notes = String(body?.notes || '').trim();
    const startIso = String(body?.start_iso || body?.start || '').trim();
    const timeZone = String(body?.time_zone || '').trim();

    if (!first || !email || !startIso) {
      return { _bm_response: true, status: 422, json: { errors: ['missing required fields'] } };
    }

    let start;
    try { start = formatUtc(startIso); } catch { start = null; }
    if (!start || Number.isNaN(start.getTime())) {
      return { _bm_response: true, status: 422, json: { errors: ['invalid start time'] } };
    }

    const { eventType, offset, windowsForWeekday, bookings } = ctx;
    const yyyy = start.toISOString().slice(0, 10);
    const localWeekday = new Date(`${yyyy}T00:00:00.000${offset}`).getUTCDay();
    const windows = windowsForWeekday(localWeekday);

    const slots = generateDailySlots({
      date: yyyy,
      windows,
      durationMin: Number(eventType.duration_min),
      intervalMin: Number(eventType.duration_min),
      tzOffset: offset,
      existingUtc: bookings.map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at })),
      bufferBeforeMin: Number(eventType.buffer_before_min || 0),
      bufferAfterMin: Number(eventType.buffer_after_min || 0),
      minNoticeMin: Number(eventType.min_notice_min || 0),
      maxNoticeDays: eventType.max_notice_days == null ? null : Number(eventType.max_notice_days),
    });

    const startIsoUtc = start.toISOString();
    if (!slots.includes(startIsoUtc)) {
      return { _bm_response: true, status: 409, json: { error: 'slot-unavailable' } };
    }

    const inviteeName = `${first}${last ? ` ${last}` : ''}`.trim();
    const end = new Date(start.getTime() + Number(eventType.duration_min) * 60_000);

    const Booking = this.model('event_booking');
    const booking = new Booking({
      event_type_id: eventType.id,
      invitee_name: inviteeName,
      invitee_email: email,
      starts_at: startIsoUtc,
      ends_at: end.toISOString(),
      status: 'confirmed',
    });

    if (!booking.save()) {
      return { _bm_response: true, status: 422, json: { errors: booking.errors.fullMessages() } };
    }

    const dayContext = this.#buildDay(ctx, {
      monthParam: String(start.getUTCMonth() + 1),
      dayParam: String(start.getUTCDate()),
      yearParam: String(start.getUTCFullYear()),
    });
    if (dayContext?.error) return dayContext;
    const summary = this.#buildContact(ctx, {
      ...dayContext,
      startParam: startIsoUtc,
      skipValidation: true,
    });

    if (!summary || summary.error) {
      return { _bm_response: true, status: 201, json: { ok: true, booking: booking.toJSON() } };
    }

    await this.#notify(ctx, { booking, notes, summary });

    if (this.wants_json(req)) {
      return { _bm_response: true, status: 201, json: { ok: true, booking: booking.toJSON() } };
    }

    return this.render('confirmation', {
      booking: booking.toJSON(),
      summary,
      invitee_name: inviteeName,
      invitee_email: email,
    });
  }

  #buildPage(ctx) {
    const { eventType, booker, organizerName, offset, basePath } = ctx;
    const duration = Number(eventType.duration_min || 0);
    const durationText = duration >= 60
      ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}`
      : `${duration} min`;
    const tzLabel = offset === '+00:00' ? 'UTC' : `UTC${offset}`;
    const { nowLocal } = this.#resolveOrganizerNow(ctx);
    const currentYear = nowLocal.getUTCFullYear();
    const currentMonth = nowLocal.getUTCMonth() + 1;

    return {
      event: {
        name: eventType.name,
        durationText,
        organizerName,
        organizerEmail: booker.email,
        tzLabel,
        tzOffset: offset,
        basePath,
        month: currentMonth,
        year: currentYear,
      }
    };
  }

  #resolveOrganizerNow(ctx, nowUtc) {
    const { offset } = ctx;
    const timestamp = Number.isFinite(nowUtc) ? nowUtc : Date.now();
    const nowLocal = fromUtc(new Date(timestamp), offset);
    return { nowUtc: timestamp, nowLocal };
  }

  #resolveMonthYear(ctx, { monthParam, yearParam, nowUtc }) {
    const { nowLocal, nowUtc: resolvedNow } = this.#resolveOrganizerNow(ctx, nowUtc);
    let month;
    if (!monthParam || monthParam === 'current') {
      month = nowLocal.getUTCMonth() + 1;
    } else {
      month = Number(monthParam);
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        return { error: { _bm_response: true, status: 400, text: 'Invalid month' } };
      }
    }

    let year = Number(yearParam);
    if (!Number.isFinite(year) || year <= 0) year = nowLocal.getUTCFullYear();

    return { month, year, nowLocal, nowUtc: resolvedNow };
  }

  #buildMonth(ctx, params) {
    const nowUtc = Date.now();
    const resolved = this.#resolveMonthYear(ctx, { ...params, nowUtc });
    if (resolved.error) return resolved;
    const { month, year, nowLocal } = resolved;
    const { offset, windowsForWeekday, eventType, bookings } = ctx;

    const firstDayLocal = new Date(`${year}-${pad(month)}-01T00:00:00.000${offset}`);
    const leadingBlanks = firstDayLocal.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayKey = (nowLocal.getUTCFullYear() * 10_000)
      + ((nowLocal.getUTCMonth() + 1) * 100)
      + nowLocal.getUTCDate();

    const dayAssignments = [];

    for (let d = 1; d <= daysInMonth; d += 1) {
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const weekday = new Date(`${dateStr}T00:00:00.000${offset}`).getUTCDay();
      const windows = windowsForWeekday(weekday);
      const dayKey = (year * 10_000) + (month * 100) + d;
      const disabled = dayKey < todayKey;
      let available = false;
      if (!disabled && windows.length > 0) {
        const slots = generateDailySlots({
          date: dateStr,
          windows,
          durationMin: Number(eventType.duration_min),
          intervalMin: Number(eventType.duration_min),
          tzOffset: offset,
          existingUtc: bookings.map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at })),
          bufferBeforeMin: Number(eventType.buffer_before_min || 0),
          bufferAfterMin: Number(eventType.buffer_after_min || 0),
          minNoticeMin: Number(eventType.min_notice_min || 0),
          maxNoticeDays: eventType.max_notice_days == null ? null : Number(eventType.max_notice_days),
        });
        available = slots.length > 0;
      }
      dayAssignments.push({
        day: d,
        date: dateStr,
        weekday,
        available: available && !disabled,
        disabled,
      });
    }

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return {
      month,
      year,
      monthName: MONTHS[month - 1] || '',
      leadingBlanks,
      days: dayAssignments,
      prev: { month: prevMonth, year: prevYear },
      next: { month: nextMonth, year: nextYear },
    };
  }

  #buildDay(ctx, params) {
    const resolved = this.#resolveMonthYear(ctx, params);
    if (resolved.error) return resolved;
    const { month, year } = resolved;
    const day = Number(params.dayParam);
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      return { error: { _bm_response: true, status: 400, text: 'Invalid day' } };
    }
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const { offset, windowsForWeekday, eventType, bookings } = ctx;
    const weekday = new Date(`${dateStr}T00:00:00.000${offset}`).getUTCDay();
    const windows = windowsForWeekday(weekday);
    const slots = generateDailySlots({
      date: dateStr,
      windows,
      durationMin: Number(eventType.duration_min),
      intervalMin: Number(eventType.duration_min),
      tzOffset: offset,
      existingUtc: bookings.map(b => ({ starts_at: b.starts_at, ends_at: b.ends_at })),
      bufferBeforeMin: Number(eventType.buffer_before_min || 0),
      bufferAfterMin: Number(eventType.buffer_after_min || 0),
      minNoticeMin: Number(eventType.min_notice_min || 0),
      maxNoticeDays: eventType.max_notice_days == null ? null : Number(eventType.max_notice_days),
    });

    const items = slots.map((iso) => {
      const local = fromUtc(iso, offset);
      const label = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
      const end = new Date(new Date(iso).getTime() + Number(eventType.duration_min) * 60_000);
      return { iso, label, end: end.toISOString() };
    });

    const localDate = fromUtc(`${dateStr}T00:00:00.000Z`, offset);

    return {
      month,
      year,
      day,
      date: dateStr,
      weekdayName: WEEKDAYS[weekday] || '',
      monthName: MONTHS[month - 1] || '',
      slots: items,
      tzOffset: offset,
      durationMin: Number(eventType.duration_min),
      localDateIso: localDate.toISOString(),
    };
  }

  #buildContact(ctx, params) {
    const dayData = params.skipValidation ? params : this.#buildDay(ctx, params);
    if (dayData?.error) return dayData;
    const { month, year, day } = dayData;
    const startIso = params.startParam;
    if (!startIso) {
      return { error: { _bm_response: true, status: 400, text: 'Missing start time' } };
    }
    const { eventType, offset, organizerName } = ctx;
    const target = dayData.slots?.find?.(s => s.iso === startIso);
    if (!params.skipValidation && !target) {
      return { error: { _bm_response: true, status: 409, text: 'Selected slot unavailable' } };
    }
    const start = new Date(startIso);
    const end = new Date(start.getTime() + Number(eventType.duration_min) * 60_000);
    const local = fromUtc(start, offset);
    const endLocal = fromUtc(end, offset);

    return {
      month,
      year,
      day,
      start_iso: start.toISOString(),
      end_iso: end.toISOString(),
      summary: `${MONTHS[month - 1] || ''} ${day}, ${year}`,
      range: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} - ${pad(endLocal.getUTCHours())}:${pad(endLocal.getUTCMinutes())}`,
      weekdayName: WEEKDAYS[local.getUTCDay()] || '',
      tzOffset: offset,
      organizerName,
      durationMin: Number(eventType.duration_min),
    };
  }

  async #notify(ctx, { booking, notes, summary }) {
    const { booker, eventType, organizerName } = ctx;
    const ics = this.#buildIcs({
      booking,
      eventType,
      organizer: booker,
      organizerName,
      notes,
    });

    const subject = `${eventType.name} with ${organizerName}`;
    const textBody = [
      `Your meeting "${eventType.name}" is confirmed.`,
      `When: ${summary.weekdayName}, ${summary.summary} ${summary.range} (${summary.tzOffset === '+00:00' ? 'UTC' : `UTC${summary.tzOffset}`})`,
      notes ? `Notes: ${notes}` : '',
      '',
      'An ICS calendar invite is attached to this email.',
    ].filter(Boolean).join('\n');

    const attendeeMessage = {
      from: booker.email,
      to: booking.invitee_email,
      subject,
      text: textBody,
      html: textBody.replace(/\n/g, '<br>'),
      attachments: [{ filename: 'invite.ics', contentType: 'text/calendar; charset="utf-8"; method=REQUEST', content: ics }],
    };

    const organizerText = [`A new booking has been scheduled.`, textBody].join('\n');
    const organizerMessage = {
      from: booker.email,
      to: booker.email,
      subject: `New booking: ${booking.invitee_name}`,
      text: organizerText,
      html: organizerText.replace(/\n/g, '<br>'),
      attachments: attendeeMessage.attachments,
    };

    await Promise.all([
      deliver(attendeeMessage),
      deliver(organizerMessage),
    ]);
  }

  #buildIcs({ booking, eventType, organizer, organizerName, notes }) {
    const lines = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Black Mamba//Booking//EN',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${booking.id}@${(organizer.email || 'black-mamba.local')}`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(booking.starts_at)}`,
      `DTEND:${formatIcsDate(booking.ends_at)}`,
      `SUMMARY:${icsEscape(eventType.name)}`,
      notes ? `DESCRIPTION:${icsEscape(notes)}` : 'DESCRIPTION:Booking created via Black Mamba',
      `ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${icsEscape(organizer.email)}`,
      `ATTENDEE;CN=${icsEscape(booking.invitee_name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${icsEscape(booking.invitee_email)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.join('\r\n');
  }
}();

