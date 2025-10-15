export default function ({ assigns }) {
  const e = assigns?.event || {};
  const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Edit ${esc(e.name)}</title></head><body>
  <h1>Edit Event Type</h1>
  <form method="post" action="/events/${e.id}/edit">
    <label>Name <input name="name" value="${esc(e.name)}" required></label><br>
    <label>Slug <input name="slug" value="${esc(e.slug)}" required></label><br>
    <label>Duration (min) <input name="duration_min" type="number" value="${e.duration_min ?? 30}" min="5"></label><br>
    <label>Time Zone Offset <input name="tz_offset" value="${esc(e.tz_offset || '+00:00')}" pattern="[+-]\\d{2}:\\d{2}"></label><br>
    <label>Buffer Before (min) <input name="buffer_before_min" type="number" value="${e.buffer_before_min ?? 0}"></label><br>
    <label>Buffer After (min) <input name="buffer_after_min" type="number" value="${e.buffer_after_min ?? 0}"></label><br>
    <label>Min Notice (min) <input name="min_notice_min" type="number" value="${e.min_notice_min ?? 0}"></label><br>
    <label>Max Notice (days) <input name="max_notice_days" type="number" value="${e.max_notice_days ?? 60}"></label><br>
    <label>Availability JSON<br>
      <textarea name="availability_json" rows="6" cols="60">${esc(e.availability_json || '{}')}</textarea>
    </label><br>
    <button type="submit">Update</button>
  </form>
  </body></html>`;
}

