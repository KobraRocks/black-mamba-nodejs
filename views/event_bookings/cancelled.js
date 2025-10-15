export default function ({ assigns }) {
  const b = assigns || {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cancelled</title></head><body>
  <h1>Booking Cancelled</h1>
  <p>Booking #${b.id} has been cancelled.</p>
  </body></html>`;
}

