export default function ({ assigns }) {
  const b = assigns || {};
  const cancelUrl = b.cancel_token ? `/event_bookings/cancel?token=${encodeURIComponent(b.cancel_token)}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Booked</title></head><body>
  <h1>Booking Confirmed</h1>
  <p>Thanks ${b.invitee_name || ''}. Your meeting is booked for ${b.starts_at}.</p>
  ${cancelUrl ? `<p><a href="${cancelUrl}">Cancel this booking</a></p>` : ''}
  </body></html>`;
}
