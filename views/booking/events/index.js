export default function ({ assigns }) {
  const list = Array.isArray(assigns) ? assigns : [];
  const items = list.map(e => `<li>${e.name} — ${e.duration_min} min</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Events</title></head><body>
  <h1>Event Types</h1>
  <ul>${items}</ul>
  </body></html>`;
}

