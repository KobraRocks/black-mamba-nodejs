
function toDate(v) { return v instanceof Date ? v : new Date(String(v)); }
export function normalizeDate(v) { const d = toDate(v); if (Number.isNaN(d.getTime())) throw new Error('Invalid date'); return d; }

export function parseOffset(off = '+00:00') {
  const m = String(off).match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) throw new Error('Invalid offset');
  const sign = m[1] === '-' ? -1 : 1;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  return sign * (hh * 60 + mm);
}

export function toUtc(localIsoOrDate, offsetStr = '+00:00') {
  const d = normalizeDate(localIsoOrDate);
  const minutes = parseOffset(offsetStr);
  const ms = d.getTime() - minutes * 60_000;
  return new Date(ms);
}

export function fromUtc(utcIsoOrDate, offsetStr = '+00:00') {
  const d = normalizeDate(utcIsoOrDate);
  const minutes = parseOffset(offsetStr);
  const ms = d.getTime() + minutes * 60_000;
  return new Date(ms);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  const A = normalizeDate(aStart).getTime();
  const B = normalizeDate(aEnd).getTime();
  const C = normalizeDate(bStart).getTime();
  const D = normalizeDate(bEnd).getTime();
  if (!(A < B && C < D)) return false;
  return A < D && C < B;
}

export function hasConflict(existingUtc = [], startUtc, endUtc, beforeMin = 0, afterMin = 0) {
  const st = normalizeDate(startUtc).getTime();
  const en = normalizeDate(endUtc).getTime();
  for (const b of existingUtc) {
    const bs = normalizeDate(b.starts_at ?? b.start ?? b.start_at).getTime() - beforeMin * 60_000;
    const be = normalizeDate(b.ends_at ?? b.end ?? b.end_at).getTime() + afterMin * 60_000;
    if (st < be && bs < en) return true;
  }
  return false;
}

function hmToMinutes(hm) { const [h, m] = String(hm).split(':').map(n => Number(n)); return h * 60 + (m || 0); }

export function generateDailySlots({ date, windows = [], durationMin = 30, intervalMin = null, tzOffset = '+00:00', existingUtc = [], bufferBeforeMin = 0, bufferAfterMin = 0, minNoticeMin = 0, maxNoticeDays = null }) {
  // date is yyyy-mm-dd in organizer local time (offset tzOffset)
  intervalMin = intervalMin || durationMin;
  const offsetMin = parseOffset(tzOffset);
  const midnightUtcMs = new Date(`${date}T00:00:00.000Z`).getTime();
  // Local midnight corresponds to UTC midnight minus offset
  const localMidnightUtcMs = midnightUtcMs - offsetMin * 60_000;

  const now = Date.now();
  const soonest = new Date(now + minNoticeMin * 60_000);
  const latest = (maxNoticeDays == null) ? null : new Date(now + Number(maxNoticeDays) * 24 * 60 * 60 * 1000);
  const slots = [];
  for (const win of windows) {
    if (!Array.isArray(win) || win.length < 2) continue;
    const [startHM, endHM] = win;
    const startM = hmToMinutes(startHM);
    const endM = hmToMinutes(endHM);
    for (let t = startM; t + durationMin <= endM; t += intervalMin) {
      const startUtc = new Date(localMidnightUtcMs + t * 60_000);
      const endUtc = new Date(startUtc.getTime() + durationMin * 60_000);
      if (startUtc < soonest) continue;
      if (latest && startUtc > latest) continue;
      if (hasConflict(existingUtc, startUtc, endUtc, bufferBeforeMin, bufferAfterMin)) continue;
      slots.push(startUtc.toISOString());
    }
  }
  return slots;
}

export default { parseOffset, toUtc, fromUtc, overlaps, hasConflict, generateDailySlots, normalizeDate };
