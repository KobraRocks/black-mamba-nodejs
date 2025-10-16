export default function ({ assigns }) {
  const e = assigns || {};
  const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(e.name)} — Book</title></head><body>
  <h1>${esc(e.name || 'Event')}</h1>
  <p>Duration: ${e.duration_min} min</p>
  <section>
    <h2>Book a Slot</h2>
    <label>Date <input id="date" type="date"></label>
    <button id="load">Load slots</button>
    <div>
      <label>Slot
        <select id="slots"></select>
      </label>
    </div>
    <form id="book" method="post" action="/booking/event_bookings">
      <input type="hidden" name="event_type_id" value="${e.id}">
      <input type="hidden" name="start_iso" id="start_iso">
      <input type="hidden" name="time_zone" id="time_zone">
      <label>Name <input name="invitee_name" required></label>
      <label>Email <input name="invitee_email" type="email" required></label>
      <button type="submit">Book</button>
    </form>
  </section>
  <script>
    const sel = document.getElementById('slots');
    const startIso = document.getElementById('start_iso');
    const tz = document.getElementById('time_zone');
    const date = document.getElementById('date');
    const load = document.getElementById('load');
    function currentZone(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }
    tz.value = currentZone();
    load.addEventListener('click', async () => {
      if (!date.value) return;
      sel.innerHTML='';
      const params = new URLSearchParams({ date: date.value });
      if (tz.value) params.set('timeZone', tz.value);
      const r = await fetch('/booking/events/s/${esc(e.slug)}/slots?'+params.toString());
      const j = await r.json();
      const arr = Array.isArray(j.slots) ? j.slots : [];
      arr.forEach(s => { const o=document.createElement('option'); if (typeof s === 'string') { o.value=s; o.textContent=s; } else { o.value=s.utc; o.textContent=s.local || s.utc; } sel.appendChild(o); });
      if (sel.value) startIso.value = sel.value;
    });
    sel.addEventListener('change', ()=> { startIso.value = sel.value; });
  </script>
  </body></html>`;
}
