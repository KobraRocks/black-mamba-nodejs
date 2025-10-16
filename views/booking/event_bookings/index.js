export default function ({ assigns }) {
  const list = Array.isArray(assigns) ? assigns : [];
  const rows = list.map(b => `<tr><td>${b.id}</td><td>${b.invitee_email}</td><td>${b.starts_at}</td><td>${b.status}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bookings</title></head><body>
  <h1>Bookings</h1>
  <table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>ID</th><th>Email</th><th>Start</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

