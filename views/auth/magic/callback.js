const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function magicCallbackView({ assigns }) {
  const data = assigns || {};
  const ok = Boolean(data.ok);
  const user = data.user || {};
  const email = escapeHtml(user.email || '');
  const superAdmin = Boolean(user.super_admin);
  const title = ok ? 'Signed in' : 'Magic link error';

  const statusMessage = ok
    ? `You are now signed in as <strong>${email}</strong>.`
    : 'We could not validate that link. Please request a fresh one and try again.';

  const superAdminMessage = superAdmin
    ? `<p class="bm-auth__note">Super admin tools are now available. Visit <a class="bm-auth__link" href="/super_admin">the super admin dashboard</a> to continue.</p>`
    : '';

  const cta = ok
    ? `<div class="bm-auth__actions">
        <a class="bm-auth__button" href="/">Go to homepage</a>
        <a class="bm-auth__button bm-auth__button--secondary" href="/booking/management">Manage bookings</a>
      </div>`
    : `<div class="bm-auth__actions">
        <a class="bm-auth__button" href="/auth/magic/new">Request a new link</a>
      </div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-auth" data-bm-magic-callback data-super-admin="${superAdmin ? 'true' : 'false'}">
      <header class="bm-auth__header">
        <div class="bm-auth__badge">Black Mamba</div>
        <h1 class="bm-auth__title">${title}</h1>
        <p class="bm-auth__status" data-variant="${ok ? 'success' : 'error'}" data-bm-callback-message>${statusMessage}</p>
      </header>
      ${cta}
      ${superAdminMessage}
      <p class="bm-auth__note">You can safely close this tab once you are done.</p>
    </main>
    <script>
      (function () {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('token')) {
            url.searchParams.delete('token');
            const next = url.pathname + (url.searchParams.size ? '?' + url.searchParams.toString() : '');
            window.history.replaceState({}, document.title, next);
          }
        } catch {}
        const message = document.querySelector('[data-bm-callback-message]');
        if (message && typeof message.focus === 'function') {
          message.setAttribute('tabindex', '-1');
          setTimeout(() => { message.focus({ preventScroll: true }); }, 50);
        }
      }());
    </script>
  </body>
</html>`;
}
