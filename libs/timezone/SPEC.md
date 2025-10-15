Black Mamba Timezone — SPEC (ESM, no deps)

Goal
- Provide IANA timezone conversions using only built‑in Intl APIs (no external deps).

API (libs/timezone/index.js)
- offsetAt(date: Date, timeZone: string): number
  - Returns the offset in minutes for the given instant in the provided IANA time zone.
- utcToLocal(utc: Date, timeZone: string): { year, month, day, hour, minute, second }
- localToUtc({ year, month, day, hour, minute, second }, timeZone: string): Date
  - Converts a wall‑clock local time in the given time zone to the corresponding UTC instant.
  - Handles DST by performing a small fixed‑point iteration.

Notes
- Relies on Node’s ICU data via Intl.DateTimeFormat. If the runtime lacks ICU for a zone, functions throw.
- No external dependencies. Temporal API would simplify implementation, but is not assumed available.

