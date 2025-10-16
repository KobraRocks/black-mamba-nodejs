const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function formatEventSummary(eventTypes = []) {
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    return 'No event types yet';
  }
  if (eventTypes.length === 1) {
    return '1 event type';
  }
  return `${eventTypes.length} event types`;
}

export default function bookingManagement({ assigns }) {
  const booker = assigns?.booker || {};
  const eventTypes = Array.isArray(assigns?.eventTypes) ? assigns.eventTypes : [];
  const eventsUrl = escapeHtml(assigns?.eventsUrl || '/booking/events/management');
  const bookingsUrl = escapeHtml(assigns?.bookingsUrl || '/booking/event_bookings/management');
  const email = escapeHtml(booker.email || '');
  const title = 'Booking Management';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-management" data-bm-management data-events-url="${eventsUrl}" data-bookings-url="${bookingsUrl}">
      <header class="bm-management__header">
        <div class="bm-management__badge">Organizer workspace</div>
        <h1 class="bm-management__title">Manage your bookings</h1>
        <p class="bm-management__meta">
          Signed in as <strong>${email}</strong> · ${escapeHtml(formatEventSummary(eventTypes))}
        </p>
        <button type="button" class="bm-management__refresh" data-bm-refresh>Refresh</button>
      </header>
      <section class="bm-management__section">
        <h2 class="bm-management__section-title">Event types</h2>
        <div class="bm-card" data-bm-events>Loading…</div>
      </section>
      <section class="bm-management__section">
        <h2 class="bm-management__section-title">Bookings</h2>
        <div class="bm-card" data-bm-bookings>Loading…</div>
      </section>
    </main>
    <script>
      (function () {
        const root = document.querySelector('[data-bm-management]');
        if (!root) return;
        const eventsTarget = root.querySelector('[data-bm-events]');
        const bookingsTarget = root.querySelector('[data-bm-bookings]');
        const eventsUrl = root.dataset.eventsUrl;
        const bookingsUrl = root.dataset.bookingsUrl;
        const loadingMarkup = '<div class="bm-loading">Loading…</div>';
        const errorMarkup = (msg) => '<div class="bm-error">' + msg + '</div>';

        async function fetchFragment(url) {
          const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
          const text = await res.text();
          if (!res.ok) {
            let message = text;
            try {
              const json = JSON.parse(text);
              if (json?.error) message = json.error;
              if (Array.isArray(json?.errors)) message = json.errors.join(', ');
            } catch {}
            throw new Error(message || 'Request failed');
          }
          return text;
        }

        function loadFragment(target, url) {
          if (!target || !url) return;
          target.innerHTML = loadingMarkup;
          fetchFragment(url)
            .then((html) => { target.innerHTML = html; })
            .catch((err) => { target.innerHTML = errorMarkup(err.message); });
        }

        const refreshBtn = root.querySelector('[data-bm-refresh]');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', () => {
            loadFragment(eventsTarget, eventsUrl);
            loadFragment(bookingsTarget, bookingsUrl);
          });
        }

        loadFragment(eventsTarget, eventsUrl);
        loadFragment(bookingsTarget, bookingsUrl);
      }());
    </script>
  </body>
</html>`;
}
