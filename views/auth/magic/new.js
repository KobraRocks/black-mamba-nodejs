const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function magicNewView({ assigns }) {
  const data = assigns || {};
  const devMode = data.dev_mode ? 'true' : 'false';
  const requestPath = escapeHtml(data.request_path || '/auth/magic/request');
  const callbackPath = escapeHtml(data.callback_path || '/auth/magic/callback');
  const hasSuperAdmin = data.has_super_admin ? 'true' : 'false';
  const superAdminEmail = escapeHtml(data.super_admin_email || '');
  const title = 'Sign in with a magic link';

  const superAdminHint = data.has_super_admin
    ? `<p class="bm-auth__note" data-bm-super-admin-hint>Requests sent to <strong>${superAdminEmail}</strong> unlock the super admin workspace.</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-auth" data-bm-magic data-request-path="${requestPath}" data-callback-path="${callbackPath}" data-dev-mode="${devMode}" data-has-super-admin="${hasSuperAdmin}">
      <header class="bm-auth__header">
        <div class="bm-auth__badge">Black Mamba</div>
        <h1 class="bm-auth__title">${title}</h1>
        <p class="bm-auth__description">We will email you a secure, single-use link. No passwords, no friction.</p>
      </header>
      <section class="bm-auth__panel">
        <form class="bm-auth__form" data-bm-magic-form method="post" action="${requestPath}">
          <div class="bm-auth__field">
            <label class="bm-auth__label" for="magic-email">Work email</label>
            <input class="bm-auth__input" type="email" id="magic-email" name="email" autocomplete="email" required placeholder="you@company.com" />
          </div>
          <button class="bm-auth__button" type="submit" data-bm-magic-submit>Send me a link</button>
        </form>
        <p class="bm-auth__status" data-bm-magic-status role="status" aria-live="polite"></p>
        ${superAdminHint}
      </section>
      <section class="bm-auth__dev" data-bm-magic-dev hidden>
        <header class="bm-auth__dev-header">
          <h2 class="bm-auth__dev-title">Development shortcut</h2>
          <p class="bm-auth__dev-description">BM_DEV is enabled, so the raw link is returned instead of emailing it.</p>
        </header>
        <div class="bm-auth__dev-body">
          <p class="bm-auth__dev-label">Magic link URL</p>
          <a class="bm-auth__dev-url" data-bm-magic-url href="#" rel="nofollow noopener" target="_blank"></a>
          <div class="bm-auth__dev-actions">
            <button class="bm-auth__dev-button" type="button" data-bm-magic-open>Open link</button>
            <button class="bm-auth__dev-button" type="button" data-bm-magic-copy>Copy link</button>
          </div>
          <p class="bm-auth__dev-label">Token</p>
          <pre class="bm-auth__dev-token" data-bm-magic-token></pre>
          <p class="bm-auth__note" data-bm-super-admin-flag hidden>This link grants super admin access.</p>
        </div>
      </section>
      <section class="bm-auth__footer">
        <p class="bm-auth__footer-text">Already have a magic link? <a class="bm-auth__link" href="${callbackPath}">Paste it here</a> after copying it from your email.</p>
      </section>
    </main>
    <script>
      (function () {
        const root = document.querySelector('[data-bm-magic]');
        if (!root) return;
        const form = root.querySelector('[data-bm-magic-form]');
        const emailInput = form?.querySelector('input[name="email"]');
        const submitBtn = form?.querySelector('[data-bm-magic-submit]');
        const status = root.querySelector('[data-bm-magic-status]');
        const devPanel = root.querySelector('[data-bm-magic-dev]');
        const devUrl = root.querySelector('[data-bm-magic-url]');
        const devToken = root.querySelector('[data-bm-magic-token]');
        const copyBtn = root.querySelector('[data-bm-magic-copy]');
        const openBtn = root.querySelector('[data-bm-magic-open]');
        const superFlag = root.querySelector('[data-bm-super-admin-flag]');
        const requestPath = root.dataset.requestPath || '/auth/magic/request';
        const devMode = root.dataset.devMode === 'true';
        let lastUrl = '';

        function setStatus(variant, message) {
          if (!status) return;
          status.dataset.variant = variant || '';
          status.textContent = message || '';
        }

        async function copyToClipboard(text) {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
              return true;
            }
          } catch {}
          try {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', 'readonly');
            input.style.position = 'absolute';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            return true;
          } catch {}
          return false;
        }

        if (copyBtn) {
          copyBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            if (!lastUrl) return;
            const ok = await copyToClipboard(lastUrl);
            if (ok) {
              copyBtn.dataset.copied = 'true';
              const original = copyBtn.textContent;
              copyBtn.textContent = 'Copied!';
              setTimeout(() => {
                copyBtn.dataset.copied = 'false';
                copyBtn.textContent = original;
              }, 1800);
            }
          });
        }

        if (openBtn) {
          openBtn.addEventListener('click', (event) => {
            event.preventDefault();
            if (!lastUrl) return;
            window.location.href = lastUrl;
          });
        }

        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const email = (emailInput?.value || '').trim();
          if (!email) {
            setStatus('error', 'Enter your work email to continue.');
            emailInput?.focus();
            return;
          }
          setStatus('pending', 'Sending magic link…');
          if (submitBtn) submitBtn.disabled = true;
          if (devPanel) devPanel.hidden = true;
          if (superFlag) superFlag.hidden = true;

          try {
            const response = await fetch(requestPath, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ email })
            });
            let payload = {};
            try {
              payload = await response.json();
            } catch {}
            if (!response.ok || !payload?.ok) {
              const message = payload?.error || 'Request failed. Please try again.';
              throw new Error(message);
            }
            setStatus('success', 'Check your inbox for a fresh sign-in link.');
            if (devMode && devPanel && payload.url) {
              lastUrl = String(payload.url);
              devPanel.hidden = false;
              if (devUrl) {
                devUrl.textContent = lastUrl;
                devUrl.href = lastUrl;
              }
              if (devToken) devToken.textContent = String(payload.token || '');
              if (superFlag) {
                if (payload.super_admin) {
                  superFlag.hidden = false;
                } else {
                  superFlag.hidden = true;
                }
              }
            }
          } catch (err) {
            setStatus('error', err?.message || 'Something went wrong.');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }());
    </script>
  </body>
</html>`;
}
