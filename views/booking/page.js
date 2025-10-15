const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function bookingPage({ assigns }) {
  const event = assigns?.event || {};
  const basePath = event.basePath || '#';
  const title = `${escapeHtml(event.organizerName || 'Organizer')} – ${escapeHtml(event.name || 'Booking')}`;
  const tzLabel = escapeHtml(event.tzLabel || 'UTC');
  const duration = escapeHtml(event.durationText || '30 min');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-booking" data-bm-booking data-base-url="${escapeHtml(basePath)}" data-initial-month="${Number(event.month) || ''}" data-initial-year="${Number(event.year) || ''}" data-tz-offset="${escapeHtml(event.tzOffset || '+00:00')}">
      <section class="bm-event">
        <div class="bm-event__badge">Powered by Black Mamba</div>
        <h1 class="bm-event__title">${escapeHtml(event.organizerName || '')}</h1>
        <h2 class="bm-event__subtitle">${escapeHtml(event.name || '')}</h2>
        <ul class="bm-event__meta">
          <li>${duration}</li>
          <li data-bm-timezone>${tzLabel}</li>
        </ul>
      </section>
      <section class="bm-flow">
        <div class="bm-flow__column">
          <div class="bm-card" data-bm-month></div>
        </div>
        <div class="bm-flow__column">
          <div class="bm-card" data-bm-day></div>
          <div class="bm-card" data-bm-contact></div>
        </div>
      </section>
    </main>
    <script>
      (function() {
        const root = document.querySelector('[data-bm-booking]');
        if (!root) return;
        const baseUrl = root.dataset.baseUrl;
        const tzOffset = root.dataset.tzOffset || '+00:00';
        const monthTarget = root.querySelector('[data-bm-month]');
        const dayTarget = root.querySelector('[data-bm-day]');
        const contactTarget = root.querySelector('[data-bm-contact]');
        const tzDisplay = root.querySelector('[data-bm-timezone]');
        const tzGuess = (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
        if (tzDisplay && tzGuess) tzDisplay.textContent = tzGuess;

        const loadingMarkup = '<div class="bm-loading">Loading…</div>';
        const errorMarkup = (msg) => '<div class="bm-error">' + msg + '</div>';

        function setLoading(target) {
          if (target) target.innerHTML = loadingMarkup;
        }

        async function fetchHtml(url, options = {}) {
          const res = await fetch(url, { headers: { 'Accept': 'text/html', ...(options.headers || {}) }, ...options });
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

        function loadMonth({ month, year } = {}) {
          const params = new URLSearchParams();
          if (month) params.set('month', month);
          else params.set('month', 'current');
          if (year) params.set('year', year);
          setLoading(monthTarget);
          fetchHtml(baseUrl + '?' + params.toString())
            .then((html) => {
              monthTarget.innerHTML = html;
              dayTarget.innerHTML = '';
              contactTarget.innerHTML = '';
              attachMonthHandlers();
            })
            .catch((err) => {
              monthTarget.innerHTML = errorMarkup(err.message);
            });
        }

        function loadDay({ month, year, day }) {
          const params = new URLSearchParams();
          params.set('month', month);
          params.set('year', year);
          params.set('day', day);
          setLoading(dayTarget);
          fetchHtml(baseUrl + '?' + params.toString())
            .then((html) => {
              dayTarget.innerHTML = html;
              contactTarget.innerHTML = '';
              attachDayHandlers({ month, year });
            })
            .catch((err) => {
              dayTarget.innerHTML = errorMarkup(err.message);
            });
        }

        function loadContact({ month, year, day, start }) {
          const params = new URLSearchParams();
          params.set('month', month);
          params.set('year', year);
          params.set('day', day);
          params.set('start', start);
          setLoading(contactTarget);
          fetchHtml(baseUrl + '/contact?' + params.toString())
            .then((html) => {
              contactTarget.innerHTML = html;
              attachContactForm({ month, year, day, start });
            })
            .catch((err) => {
              contactTarget.innerHTML = errorMarkup(err.message);
            });
        }

        function attachMonthHandlers() {
          monthTarget.querySelectorAll('[data-bm-month-nav]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              const month = btn.dataset.month;
              const year = btn.dataset.year;
              loadMonth({ month, year });
            });
          });
          monthTarget.querySelectorAll('[data-bm-day]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
              const month = btn.dataset.month;
              const year = btn.dataset.year;
              const day = btn.dataset.day;
              loadDay({ month, year, day });
            });
          });
        }

        function attachDayHandlers({ month, year }) {
          dayTarget.querySelectorAll('[data-bm-slot]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              const day = btn.dataset.day;
              const start = btn.dataset.start;
              loadContact({ month, year, day, start });
            });
          });
        }

        function attachContactForm({ month, year, day, start }) {
          const form = contactTarget.querySelector('form');
          if (!form) return;
          const tzField = form.querySelector('input[name="time_zone"]');
          if (tzField) tzField.value = tzGuess || '';
          const startField = form.querySelector('input[name="start_iso"]');
          if (startField) startField.value = start;
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = new FormData(form);
            if (!data.get('start_iso')) data.set('start_iso', start);
            const payload = Object.fromEntries(data.entries());
            contactTarget.innerHTML = loadingMarkup;
            try {
              const res = await fetch(baseUrl + '/contact', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'text/html',
                },
                body: JSON.stringify(payload),
              });
              const text = await res.text();
              if (!res.ok) {
                let msg = text;
                try {
                  const json = JSON.parse(text);
                  if (json?.error) msg = json.error;
                  if (Array.isArray(json?.errors)) msg = json.errors.join(', ');
                } catch {}
                throw new Error(msg);
              }
              contactTarget.innerHTML = text;
              loadMonth({ month, year });
            } catch (err) {
              contactTarget.innerHTML = errorMarkup(err.message || 'Unable to schedule');
            }
          });
        }

        const initialMonth = root.dataset.initialMonth || 'current';
        const initialYear = root.dataset.initialYear || '';
        loadMonth({ month: initialMonth, year: initialYear });
      })();
    </script>
  </body>
</html>`;
}

