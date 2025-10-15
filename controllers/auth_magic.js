import '../libs/env/index.js';
import { ApplicationController } from './application.js';
import { createMagicLink, consumeMagicLink, memoryStore } from '../libs/magick-links/src/index.js';
import crypto from 'node:crypto';
import { getSuperAdminEmail, hasSuperAdmin, isSuperAdmin } from '../libs/super-admin/index.js';

function keystoreFromEnv() {
  const secret = process.env.BM_MAGIC_SECRET || process.env.BM_SESSION_SECRET || 'dev-secret-change-me';
  return { current: { kid: 'v1', key: crypto.createHash('sha256').update(String(secret)).digest() } };
}

const store = memoryStore();

export const AuthMagic = new class extends ApplicationController {
  namespace = 'auth';
  resources = 'magic';

  constructor() {
    super();
    this.custom_routes.add(['POST', 'request_link', 'request']);
    this.custom_routes.add(['GET', 'callback', 'callback']);
  }

  #viewAssigns() {
    const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
    return {
      dev_mode: isDev,
      request_path: '/auth/magic/request',
      callback_path: '/auth/magic/callback',
      has_super_admin: hasSuperAdmin(),
      super_admin_email: getSuperAdminEmail()
    };
  }

  index(_req, _res) {
    return this.render('new', this.#viewAssigns());
  }

  new(_req, _res) {
    return this.#viewAssigns();
  }

  async request_link(req, _res) {
    const body = await req.body();
    const email = String(body?.email || '').toLowerCase().trim();
    if (!email) return { _bm_response: true, status: 400, json: { ok: false, error: 'email required' } };
    const host = req.headers['host'] || `localhost:${process.env.BM_PORT || 3000}`;
    const origin = `http://${host}`;
    const baseUrl = `${origin}/auth/magic/callback`;
    const { token, url } = createMagicLink(
      { sub: email, purpose: 'login' },
      { baseUrl, keystore: keystoreFromEnv(), origin }
    );
    const superAdmin = isSuperAdmin(email);
    // In dev, return the link for convenience; in prod, would send via SMTP
    const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
    if (isDev) {
      console.log('[DEV][magic.request] email=%s url=%s token=%s super_admin=%s', email, url, token.slice(0, 16) + '...', superAdmin);
      return { ok: true, url, token, super_admin: superAdmin };
    }
    return { ok: true };
  }

  async callback(req, _res) {
    const token = req.url.searchParams.get('token') || '';
    const host = req.headers['host'] || `localhost:${process.env.BM_PORT || 3000}`;
    const origin = `http://${host}`;
    const result = await consumeMagicLink(token, { expected: { purpose: 'login', origin }, store, keystore: keystoreFromEnv() });
    const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
    if (!result.valid) {
      if (isDev) console.warn('[DEV][magic.callback] invalid token reason=%s token=%s', result.reason, String(token).slice(0, 16) + '...');
      return { _bm_response: true, status: 400, json: { ok: false, error: 'invalid' } };
    }
    const email = String(result.claims.sub).toLowerCase();
    const superAdmin = isSuperAdmin(email);
    let user = this.User.find_by({ email });
    if (!user) user = this.User.create({ email });
    let sessionStatus = 'guest';
    try {
      const BookingUser = this.BookingUser ?? this.model('booking_user');
      if (BookingUser) {
        const statuses = BookingUser.statuses || {};
        const guest = statuses.GUEST || 'guest';
        const admin = statuses.ADMIN || 'admin';
        let profile = BookingUser.find_by?.({ user_id: user.id });
        if (!profile) {
          const initial = superAdmin ? admin : guest;
          profile = BookingUser.create({ user_id: user.id, status: initial });
        } else if (superAdmin && profile.status !== admin) {
          profile.assign({ status: admin });
          profile.save();
        }
        if (profile?.status) sessionStatus = profile.status;
        else sessionStatus = superAdmin ? admin : guest;
      }
    } catch {}
    await req.session.setUser(user.id);
    if (typeof req.session.setUserStatus === 'function') req.session.setUserStatus(sessionStatus);
    else req.session.set?.('user_status', sessionStatus);
    if (superAdmin) req.session.set('super_admin', true);
    else req.session.unset('super_admin');
    await req.session.save();
    if (isDev) console.log('[DEV][magic.callback] user_id=%d email=%s super_admin=%s', user.id, email, superAdmin);
    return { ok: true, user: { id: Number(user.id), email: user.email, super_admin: superAdmin } };
  }
}();
