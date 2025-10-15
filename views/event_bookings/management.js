const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function formatIso(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return escapeHtml(iso);
    return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  } catch {
    return escapeHtml(iso);
  }
}

export default function bookingsManagement({ assigns }) {
  const bookings = Array.isArray(assigns?.bookings) ? assigns.bookings : [];
  if (bookings.length === 0) {
    return '<div class="bm-empty">No bookings yet.</div>';
  }
  const items = bookings.map((booking) => {
    const eventName = escapeHtml(booking?.event?.name || 'Event');
    const invitee = escapeHtml(booking.invitee_name || 'Guest');
    const email = escapeHtml(booking.invitee_email || '');
    const status = escapeHtml((booking.status || '').toUpperCase());
    const start = formatIso(booking.starts_at);
    return `<li class="bm-management__item">
      <div class="bm-management__item-primary">
        <strong>${eventName}</strong>
        <span class="bm-management__item-meta">${invitee} &lt;${email}&gt;</span>
      </div>
      <div class="bm-management__item-secondary">
        <span class="bm-management__item-meta">${status}</span>
        <span class="bm-management__item-meta">Starts ${start}</span>
      </div>
    </li>`;
  }).join('');
  return `<ul class="bm-management__list">${items}</ul>`;
}
