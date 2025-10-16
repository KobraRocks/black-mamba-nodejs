Black Mamba Booking — Calendly‑style SPEC (ESM, no deps)

Scope
- Simple, self‑hosted scheduling (Calendly‑like) with event types, slot generation, and bookings.
- Pure Node.js (ESM); zero external dependencies.
- Time zone handled via fixed offsets (e.g., "+00:00", "+02:00").

Domain
- Roles:
  - Admin/Organizer ("booker"): authenticated user who creates and manages event types.
  - Guest ("invitee"): external person booking a slot.
- EventType: a meeting template owned by an organizer (e.g., "30 min intro call"). Controls duration and weekly availability windows.
- EventBooking: a scheduled meeting instance linking an EventType and an invitee.

Data Model
- event_types
  - id (auto)
  - user_id: integer (mandatory, references users(id))
  - name: string (mandatory)
  - slug: string (mandatory, unique)
  - duration_min: integer (mandatory)
  - tz_offset: string (mandatory, default "+00:00") // organizer base offset
  - availability_json: text (JSON) // weekly windows per weekday: { "1":[["09:00","12:00"],["13:00","17:00"]], ... }
  - buffer_before_min: integer (default 0)
  - buffer_after_min: integer (default 0)
  - min_notice_min: integer (default 0)
  - max_notice_days: integer (default 60)
  - timestamps

- event_bookings
  - id (auto)
  - event_type_id: integer (mandatory, references event_types(id))
  - invitee_name: string (mandatory)
  - invitee_email: string (mandatory)
  - starts_at: text ISO8601 UTC (mandatory)
  - ends_at: text ISO8601 UTC (mandatory)
  - status: string (default 'confirmed')
  - timestamps

Rules
- Slots generated on a half‑open basis [start, end) with interval = duration_min.
- Enforce buffers around existing bookings.
- Respect min_notice_min (soonest start) and max_notice_days (latest allowed day).
- Invitee email must contain '@'.

Library API (libs/booking/index.js)
- parseOffset(offset "+HH:MM"|"-HH:MM"): minutes
- toUtc(tsLocal, offset): utcDate
- fromUtc(tsUtc, offset): localDate
- generateDailySlots({ date, windows, durationMin, intervalMin, tzOffset, existingUtc, bufferBeforeMin, bufferAfterMin, minNoticeMin }): string[] // ISO UTC start times
- hasConflict(existingUtc, startUtc, endUtc, bufferBeforeMin, bufferAfterMin): boolean

HTTP (Controllers)
- Booking Pages (`controllers/booking/pages.js`, resources = 'booking', routeRoot = '/booking')
  - page/contact/month/day actions drive the public invite flow
- Events (`controllers/booking/event_types.js`, resources = 'events', routeRoot = '/events' → `/booking/events`)
  - index: list event types (JSON/HTML)
  - show: event type (JSON/HTML)
  - slots (GET /booking/events/:id/slots): returns available start times for a given date and viewer tz_offset
  - create/update/destroy: organizer‑only (requires session user)
  - mine (GET /booking/events?mine=1): list event types owned by current user
  - public by slug:
    - GET /booking/events/s/:slug — show public event type
    - GET /booking/events/s/:slug/slots — slots by slug
- EventBookings (`controllers/booking/event_bookings.js`, resources = 'event_bookings', routeRoot = '/event_bookings' → `/booking/event_bookings`)
  - create: create a booking for an event type, if the slot is still available
  - index: organizer‑only; list bookings for owned event types (filter by event_type_id optional)

Views
- views/booking/booking/* — public booking shell (page, month, day, contact, confirmation)
- views/booking/events/index.js — list event types
- views/booking/events/show.js — event type detail
- views/booking/event_bookings/index.js — booking list for organizers

Adaptation Notes
- Uses fixed offsets for time zone conversion to avoid external deps.
- Stores weekly availability as JSON text on event_types.
