const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export default function signinIndexView({ assigns }) {
  const data = assigns || {};
  const devMode = data.dev_mode ? 'true' : 'false';
  const nextPath = escapeHtml(data.next_path || '/');
  const requestPath = escapeHtml(data.magic_request_path || '/auth/magic/request');
  const callbackPath = escapeHtml(data.magic_callback_path || '/auth/magic/callback');
  const passkeyOptions = escapeHtml(data.passkey_options_path || '/auth/webauthn/login/options');
  const passkeyVerify = escapeHtml(data.passkey_verify_path || '/auth/webauthn/login/verify');
  const hasSuperAdmin = data.has_super_admin ? 'true' : 'false';
  const superAdminEmail = escapeHtml(data.super_admin_email || '');

  const superAdminHint = data.has_super_admin
    ? `<p class="bm-auth__note" data-bm-super-admin-hint>Requests sent to <strong>${superAdminEmail}</strong> unlock the super admin workspace.</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in • Black Mamba</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-auth" data-bm-signin data-next="${nextPath}" data-magic-request="${requestPath}" data-magic-callback="${callbackPath}" data-passkey-options="${passkeyOptions}" data-passkey-verify="${passkeyVerify}" data-dev-mode="${devMode}" data-has-super-admin="${hasSuperAdmin}" data-super-admin-email="${superAdminEmail}">
      <header class="bm-auth__header">
        <div class="bm-auth__badge">Black Mamba</div>
        <h1 class="bm-auth__title">Welcome back</h1>
        <p class="bm-auth__description">Choose a sign-in method below. Magic links land in your inbox, while passkeys sign you in instantly.</p>
      </header>
      <section class="bm-auth__panel">
        <h2 class="bm-auth__label">Magic link</h2>
        <p class="bm-auth__note">We will email you a one-time link for quick, passwordless access.</p>
        <form class="bm-auth__form" data-bm-magic-form method="post" action="${requestPath}">
          <div class="bm-auth__field">
            <label class="bm-auth__label" for="signin-email">Work email</label>
            <input class="bm-auth__input" type="email" id="signin-email" name="email" autocomplete="email" required placeholder="you@company.com" data-bm-email />
          </div>
          <button class="bm-auth__button" type="submit" data-bm-magic-submit>Send magic link</button>
        </form>
        <p class="bm-auth__status" data-bm-magic-status role="status" aria-live="polite"></p>
        ${superAdminHint}
      </section>
      <section class="bm-auth__panel" data-bm-passkey-panel>
        <h2 class="bm-auth__label">Passkey</h2>
        <p class="bm-auth__note">Use a passkey registered on this device for an instant sign-in experience.</p>
        <div class="bm-auth__actions">
          <button class="bm-auth__button bm-auth__button--secondary" type="button" data-bm-passkey-button>Use my passkey</button>
        </div>
        <p class="bm-auth__status" data-bm-passkey-status role="status" aria-live="polite"></p>
        <p class="bm-auth__note" data-bm-passkey-unavailable hidden>Passkeys are not supported in this browser yet. Try a magic link instead.</p>
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
        const root = document.querySelector('[data-bm-signin]');
        if (!root) return;
        const form = root.querySelector('[data-bm-magic-form]');
        const emailInput = root.querySelector('[data-bm-email]');
        const submitBtn = form?.querySelector('[data-bm-magic-submit]');
        const magicStatus = root.querySelector('[data-bm-magic-status]');
        const devPanel = root.querySelector('[data-bm-magic-dev]');
        const devUrl = root.querySelector('[data-bm-magic-url]');
        const devToken = root.querySelector('[data-bm-magic-token]');
        const copyBtn = root.querySelector('[data-bm-magic-copy]');
        const openBtn = root.querySelector('[data-bm-magic-open]');
        const superFlag = root.querySelector('[data-bm-super-admin-flag]');
        const passkeyBtn = root.querySelector('[data-bm-passkey-button]');
        const passkeyStatus = root.querySelector('[data-bm-passkey-status]');
        const passkeyUnavailable = root.querySelector('[data-bm-passkey-unavailable]');
        const requestPath = root.dataset.magicRequest || '/auth/magic/request';
        const optionsPath = root.dataset.passkeyOptions || '/auth/webauthn/login/options';
        const verifyPath = root.dataset.passkeyVerify || '/auth/webauthn/login/verify';
        const nextPath = root.dataset.next || '/';
        const devMode = root.dataset.devMode === 'true';
        const hasSuperAdmin = root.dataset.hasSuperAdmin === 'true';
        const superAdminEmail = root.dataset.superAdminEmail || '';
        let lastUrl = '';

        function setMagicStatus(variant, message) {
          if (!magicStatus) return;
          magicStatus.dataset.variant = variant || '';
          magicStatus.textContent = message || '';
        }

        function setPasskeyStatus(variant, message) {
          if (!passkeyStatus) return;
          passkeyStatus.dataset.variant = variant || '';
          passkeyStatus.textContent = message || '';
        }

        function copyToClipboard(text) {
          if (!text) return Promise.resolve(false);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
          }
          return new Promise((resolve) => {
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
              resolve(true);
            } catch {
              resolve(false);
            }
          });
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
                copyBtn.textContent = original || 'Copy link';
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

        const superHint = root.querySelector('[data-bm-super-admin-hint]');
        if (superHint && !hasSuperAdmin) {
          superHint.remove();
        }

        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const email = (emailInput?.value || '').trim();
          if (!email) {
            setMagicStatus('error', 'Enter your work email to continue.');
            emailInput?.focus();
            return;
          }
          setMagicStatus('pending', 'Sending magic link…');
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
            setMagicStatus('success', 'Check your inbox for a fresh sign-in link.');
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
            setMagicStatus('error', err?.message || 'Something went wrong.');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });

        function base64urlToArrayBuffer(value) {
          const str = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
          const pad = str.length % 4;
          const padded = str + (pad ? '='.repeat(4 - pad) : '');
          const binary = window.atob(padded);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes.buffer;
        }

        function arrayBufferToBase64url(buffer) {
          const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return window
            .btoa(binary)
            .split('+').join('-')
            .split('/').join('_')
            .replace(/=+$/g, '');
        }

        async function handlePasskeySignIn() {
          if (!window.PublicKeyCredential || !navigator.credentials) {
            setPasskeyStatus('error', 'Passkeys are not supported here yet.');
            if (passkeyUnavailable) passkeyUnavailable.hidden = false;
            if (passkeyBtn) passkeyBtn.disabled = true;
            return;
          }

          const email = (emailInput?.value || '').trim();
          setPasskeyStatus('pending', 'Looking for passkeys…');
          if (passkeyBtn) passkeyBtn.disabled = true;

          try {
            const qs = email ? '?email=' + encodeURIComponent(email) : '';
            const response = await fetch(optionsPath + qs, {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            });
            let options = {};
            try {
              options = await response.json();
            } catch {}
            if (!response.ok || !options?.challenge) {
              if (options?.error === 'unknown-user') {
                throw new Error('We could not find a passkey for that email yet. Try a magic link.');
              }
              throw new Error(options?.error || 'Unable to start passkey sign-in.');
            }

            const publicKey = {
              challenge: base64urlToArrayBuffer(options.challenge),
              allowCredentials: Array.isArray(options.allowCredentials)
                ? options.allowCredentials.map((item) => ({
                    type: item.type || 'public-key',
                    id: base64urlToArrayBuffer(item.id),
                    transports: item.transports,
                  }))
                : [],
              rpId: options.rpId,
              userVerification: 'preferred'
            };

            const credential = await navigator.credentials.get({ publicKey });
            if (!credential) throw new Error('No passkey credential was selected.');

            const body = {
              id: credential.id,
              rawId: arrayBufferToBase64url(credential.rawId),
              type: credential.type,
              response: {
                clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON),
                authenticatorData: arrayBufferToBase64url(credential.response.authenticatorData),
                signature: arrayBufferToBase64url(credential.response.signature),
                userHandle: credential.response.userHandle
                  ? arrayBufferToBase64url(credential.response.userHandle)
                  : null,
              },
            };

            const extensions = credential.getClientExtensionResults?.();
            if (extensions && Object.keys(extensions).length > 0) {
              body.clientExtensionResults = extensions;
            }

            const verifyResponse = await fetch(verifyPath, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });
            let payload = {};
            try {
              payload = await verifyResponse.json();
            } catch {}
            if (!verifyResponse.ok || !payload?.ok) {
              const message = payload?.error || 'Passkey verification failed.';
              throw new Error(message);
            }
            const redirectTo = typeof payload?.redirect === 'string' && payload.redirect.startsWith('/')
              ? payload.redirect
              : nextPath || '/';
            setPasskeyStatus('success', 'Signed in successfully. Redirecting…');
            window.setTimeout(() => {
              window.location.href = redirectTo;
            }, 600);
          } catch (err) {
            setPasskeyStatus('error', err?.message || 'Passkey sign-in failed.');
          } finally {
            if (passkeyBtn) passkeyBtn.disabled = false;
          }
        }

        if (!window.PublicKeyCredential || !navigator.credentials) {
          if (passkeyUnavailable) passkeyUnavailable.hidden = false;
          if (passkeyBtn) {
            passkeyBtn.disabled = true;
            passkeyBtn.textContent = 'Passkey unavailable';
          }
          setPasskeyStatus('', '');
        } else if (passkeyBtn) {
          passkeyBtn.addEventListener('click', (event) => {
            event.preventDefault();
            handlePasskeySignIn();
          });
        }
      }());
    </script>
  </body>
</html>`;
}
