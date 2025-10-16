const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function renderMonth({ assigns }) {
  const data = assigns || {};
  const leading = Number(data.leadingBlanks) || 0;
  const days = Array.isArray(data.days) ? data.days : [];
  const monthValue = Number(data.month) || (new Date().getUTCMonth() + 1);
  const monthName = escapeHtml(data.monthName || '');
  const year = Number(data.year) || new Date().getUTCFullYear();

  const prev = data.prev || {};
  const next = data.next || {};

  const cells = [];
  for (let i = 0; i < leading; i += 1) {
    cells.push('<div class="bm-month__cell bm-month__cell--empty"></div>');
  }
  for (const day of days) {
    const disabled = day.disabled || !day.available;
    const attrs = [
      'class="bm-month__cell"',
      `data-day="${escapeHtml(String(day.day))}"`,
      `data-month="${escapeHtml(String(monthValue))}"`,
      `data-year="${escapeHtml(String(year))}"`,
      'data-bm-day="true"',
    ];
    if (disabled) attrs.push('disabled', 'aria-disabled="true"');
    const btn = `<button ${attrs.join(' ')}>${escapeHtml(String(day.day))}</button>`;
    cells.push(btn);
  }

  const weekdays = WEEKDAYS.map((d) => `<div class="bm-month__weekday">${d}</div>`).join('');

  return `
<div class="bm-month" data-month="${escapeHtml(String(monthValue))}" data-year="${escapeHtml(String(year))}">
  <header class="bm-month__header">
    <button class="bm-month__nav" data-bm-month-nav data-month="${escapeHtml(String(prev.month || monthValue))}" data-year="${escapeHtml(String(prev.year || year))}" aria-label="Previous month">‹</button>
    <div class="bm-month__title">${monthName} ${escapeHtml(String(year))}</div>
    <button class="bm-month__nav" data-bm-month-nav data-month="${escapeHtml(String(next.month || monthValue))}" data-year="${escapeHtml(String(next.year || year))}" aria-label="Next month">›</button>
  </header>
  <div class="bm-month__weekdays">${weekdays}</div>
  <div class="bm-month__grid">${cells.join('')}</div>
</div>`;
}

