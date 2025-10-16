export default function () {
  return `<!doctype html><html><head><meta charset="utf-8"><title>New Event</title></head><body>
  <h1>New Event Type</h1>
  <form method="post" action="/booking/events">
    <label>Name <input name="name" required></label><br>
    <label>Slug <input name="slug" required></label><br>
    <label>Duration (min) <input name="duration_min" type="number" value="30" min="5"></label><br>
    <label>Time Zone Offset <input name="tz_offset" value="+00:00" pattern="[+-]\\d{2}:\\d{2}"></label><br>
    <label>Buffer Before (min) <input name="buffer_before_min" type="number" value="0"></label><br>
    <label>Buffer After (min) <input name="buffer_after_min" type="number" value="0"></label><br>
    <label>Min Notice (min) <input name="min_notice_min" type="number" value="0"></label><br>
    <label>Max Notice (days) <input name="max_notice_days" type="number" value="60"></label><br>
    <label>Availability JSON<br>
      <textarea name="availability_json" rows="6" cols="60">{"1":[["09:00","12:00"],["13:00","17:00"]]}</textarea>
    </label><br>
    <button type="submit">Create</button>
  </form>
  </body></html>`;
}

