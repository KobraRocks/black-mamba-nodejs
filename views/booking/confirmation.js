const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function renderConfirmation({ assigns }) {
  const data = assigns || {};
  const summary = data.summary || {};
  const tz = summary.tzOffset === '+00:00' ? 'UTC' : `UTC${summary.tzOffset || ''}`;

  return `
<div class="bm-confirmation">
  <h3>You're booked!</h3>
  <p>${escapeHtml(data.invitee_name || 'Guest')}, we've sent a confirmation email to ${escapeHtml(data.invitee_email || '')}.</p>
  <p class="bm-confirmation__when">${escapeHtml(summary.weekdayName || '')}, ${escapeHtml(summary.summary || '')} · ${escapeHtml(summary.range || '')} <span>${escapeHtml(tz)}</span></p>
  <p>Check your inbox for an ICS invite so you can add the event to your calendar.</p>
</div>`;
}

