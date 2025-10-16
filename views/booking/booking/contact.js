const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function renderContact({ assigns }) {
  const data = assigns || {};
  const summary = `${escapeHtml(data.weekdayName || '')}, ${escapeHtml(data.summary || '')}`;
  const tz = data.tzOffset === '+00:00' ? 'UTC' : `UTC${data.tzOffset || ''}`;
  const range = escapeHtml(data.range || '');

  return `
<div class="bm-contact">
  <header class="bm-contact__header">
    <div class="bm-contact__when">${summary}</div>
    <div class="bm-contact__range">${range} <span>${escapeHtml(tz)}</span></div>
  </header>
  <form class="bm-contact__form">
    <input type="hidden" name="start_iso" value="${escapeHtml(data.start_iso || '')}" />
    <input type="hidden" name="time_zone" value="" />
    <div class="bm-field">
      <label>First name
        <input type="text" name="first_name" required autocomplete="given-name" />
      </label>
    </div>
    <div class="bm-field">
      <label>Last name
        <input type="text" name="last_name" autocomplete="family-name" />
      </label>
    </div>
    <div class="bm-field">
      <label>Email
        <input type="email" name="email" required autocomplete="email" />
      </label>
    </div>
    <div class="bm-field">
      <label>Notes
        <textarea name="notes" rows="3" placeholder="Share anything that will help prepare"></textarea>
      </label>
    </div>
    <div class="bm-actions">
      <button type="submit" class="bm-submit">Schedule Event</button>
    </div>
  </form>
</div>`;
}

