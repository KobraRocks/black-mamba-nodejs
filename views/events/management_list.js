const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function formatDuration(minutes) {
  const value = Number(minutes) || 0;
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const remainder = value % 60;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
  }
  return `${value} min`;
}

export default function eventsManagementList({ assigns }) {
  const events = Array.isArray(assigns?.events) ? assigns.events : [];
  if (events.length === 0) {
    return `<div class="bm-empty">No event types yet. <a href="/events/new">Create one</a>.</div>`;
  }
  const rows = events.map((event) => {
    const name = escapeHtml(event.name || 'Untitled');
    const duration = escapeHtml(formatDuration(event.duration_min));
    const slug = escapeHtml(event.slug || '');
    return `<li class="bm-management__item">
      <div class="bm-management__item-primary">
        <strong>${name}</strong>
        <span class="bm-management__item-meta">${duration}</span>
      </div>
      <div class="bm-management__item-secondary">
        <span class="bm-management__item-meta">Slug: ${slug}</span>
      </div>
    </li>`;
  }).join('');
  return `<ul class="bm-management__list">${rows}</ul>`;
}
