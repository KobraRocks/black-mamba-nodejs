// IANA timezone helpers using built-in Intl APIs (no external deps)

function dtf(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
}

function partsOf(date, timeZone) {
  const parts = dtf(timeZone).formatToParts(date);
  const map = Object.create(null);
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function offsetAt(date, timeZone) {
  const p = partsOf(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Offset is local(timeZone) - UTC in ms; positive for zones east of UTC
  return Math.round((asUTC - date.getTime()) / 60000);
}

export function utcToLocal(utcDate, timeZone) {
  return partsOf(utcDate, timeZone);
}

export function localToUtc(local, timeZone) {
  // Initial guess: interpret local as UTC, then adjust by offset, iterate once
  let guess = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour || 0, local.minute || 0, local.second || 0));
  let off = offsetAt(guess, timeZone);
  let utcMs = guess.getTime() - off * 60000;
  // Recompute with the new instant (handles DST transitions)
  const secondGuess = new Date(utcMs);
  off = offsetAt(secondGuess, timeZone);
  utcMs = guess.getTime() - off * 60000;
  return new Date(utcMs);
}

export default { offsetAt, utcToLocal, localToUtc };

