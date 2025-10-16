const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function renderDay({ assigns }) {
  const data = assigns || {};
  const slots = Array.isArray(data.slots) ? data.slots : [];
  const header = `${escapeHtml(data.weekdayName || '')}, ${escapeHtml(data.monthName || '')} ${escapeHtml(String(data.day || ''))}`;
  const tz = data.tzOffset === '+00:00' ? 'UTC' : `UTC${data.tzOffset || ''}`;
  let body;

  if (slots.length === 0) {
    body = '<p class="bm-empty">No availability for this day.</p>';
  } else {
    body = slots.map((slot) => {
      const attrs = [
        'class="bm-slot"',
        'data-bm-slot="true"',
        `data-start="${escapeHtml(slot.iso)}"`,
        `data-day="${escapeHtml(String(data.day || ''))}"`,
      ];
      return `<button ${attrs.join(' ')}>${escapeHtml(slot.label)}</button>`;
    }).join('');
  }

  return `
<div class="bm-day" data-day="${escapeHtml(String(data.day || ''))}">
  <header class="bm-day__header">
    <div class="bm-day__title">${header}</div>
    <div class="bm-day__tz">${escapeHtml(tz)}</div>
  </header>
  <div class="bm-day__slots">${body}</div>
</div>`;
}

