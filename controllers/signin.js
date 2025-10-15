import { ApplicationController } from './application.js';
import { hasSuperAdmin, getSuperAdminEmail } from '../libs/super-admin/index.js';
import { isSmtpConfigured } from '../libs/smtp/index.js';

function sanitizeNext(path) {
  const value = typeof path === 'string' ? path.trim() : '';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  if (value === '/signin') return '/';
  return value || '/';
}

export const Signin = new class extends ApplicationController {
  resources = 'signin';

  #nextPath(request) {
    try {
      const params = request?.url?.searchParams;
      if (!params) return '/';
      const raw = params.get('next');
      if (!raw) return '/';
      return sanitizeNext(raw);
    } catch {
      return '/';
    }
  }

  #stashNextInSession(request, nextPath) {
    try {
      const session = request?.session;
      if (!session || typeof session.set !== 'function') return;
      session.set('post_auth_redirect', nextPath);
      const maybe = session.save?.();
      if (maybe && typeof maybe.then === 'function') maybe.catch(() => {});
    } catch {}
  }

  index(request, _response) {
    const nextPath = this.#nextPath(request);
    this.#stashNextInSession(request, nextPath);

    const sessionUser = (() => {
      try {
        if (typeof request?.session?.getUserId === 'function') return request.session.getUserId();
        return null;
      } catch {
        return null;
      }
    })();

    if (sessionUser) {
      if (this.wants_json(request)) {
        return { _bm_response: true, status: 200, json: { ok: true, redirect: nextPath } };
      }
      return { _bm_response: true, status: 303, headers: { Location: nextPath || '/' } };
    }

    const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
    const smtpReady = isSmtpConfigured();
    const assigns = {
      dev_mode: isDev && !smtpReady,
      next_path: nextPath,
      magic_request_path: '/auth/magic/request',
      magic_callback_path: '/auth/magic/callback',
      passkey_options_path: '/auth/webauthn/login/options',
      passkey_verify_path: '/auth/webauthn/login/verify',
      has_super_admin: hasSuperAdmin(),
      super_admin_email: getSuperAdminEmail(),
    };

    return this.render('index', assigns);
  }
}();
