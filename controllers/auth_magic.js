import '../libs/env/index.js';
import { ApplicationController } from './application.js';
import { createMagicLink, consumeMagicLink, memoryStore } from '../libs/magick-links/src/index.js';
import crypto from 'node:crypto';
import { getSuperAdminEmail, hasSuperAdmin, isSuperAdmin } from '../libs/super-admin/index.js';
import { sendMail, isSmtpConfigured } from '../libs/smtp/index.js';

function keystoreFromEnv() {
  const secret = process.env.BM_MAGIC_SECRET || process.env.BM_SESSION_SECRET || 'dev-secret-change-me';
  return { current: { kid: 'v1', key: crypto.createHash('sha256').update(String(secret)).digest() } };
}

const store = memoryStore();

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostToDomain(host = '') {
  const value = String(host || '').trim();
  if (!value) return 'black-mamba.local';
  const withoutPort = value.split(':')[0] || value;
  return withoutPort || 'black-mamba.local';
}

function buildMagicLinkEmail({ email, url, host, superAdmin }) {
  const domain = hostToDomain(host);
  const from = `Black Mamba <no-reply@${domain}>`;
  const subject = 'Your Black Mamba sign-in link';
  const textLines = [
    'Hello,',
    '',
    'Use the link below to sign in to Black Mamba:',
    url,
    '',
    'This link expires in 10 minutes.',
    superAdmin ? 'This link grants super admin access.' : '',
    '',
    'If you did not request this email, you can safely ignore it.',
  ].filter(Boolean);
  const text = textLines.join('\n');
  const urlHtml = `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const htmlParts = [
    '<p>Hello,</p>',
    `<p>Use the link below to sign in to Black Mamba:<br>${urlHtml}</p>`,
    '<p>This link expires in 10 minutes.</p>',
    superAdmin ? '<p><strong>This link grants super admin access.</strong></p>' : '',
    '<p>If you did not request this email, you can safely ignore it.</p>',
  ].filter(Boolean);
  const html = htmlParts.join('');
  return { from, to: email, subject, text, html };
}

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
    const devMagicPreview = isDev && !isSmtpConfigured();
    return {
      dev_mode: devMagicPreview,
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
    const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
    const smtpReady = isSmtpConfigured();
    const shouldSendEmail = !isDev || smtpReady;

    if (!shouldSendEmail) {
      console.log('[DEV][magic.request] email=%s url=%s token=%s super_admin=%s', email, url, token.slice(0, 16) + '...', superAdmin);
      return { ok: true, url, token, super_admin: superAdmin };
    }

    try {
      const message = buildMagicLinkEmail({ email, url, host, superAdmin });
      const result = await sendMail(message);
      if (result?.error) throw result.error;
      if (isDev) {
        console.log('[DEV][magic.request] emailed magic link to %s super_admin=%s', email, superAdmin);
      }
      return { ok: true };
    } catch (err) {
      console.error('[magic.request] failed to send magic link to %s: %s', email, err?.message || err);
      return {
        _bm_response: true,
        status: 502,
        json: { ok: false, error: 'We could not send the magic link email. Please try again.' },
      };
    }
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
    const redirectTo = this.consume_post_auth_redirect(req, { fallback: '/' });
    await req.session.save();
    if (isDev) console.log('[DEV][magic.callback] user_id=%d email=%s super_admin=%s', user.id, email, superAdmin);
    if (this.prefers_signin_redirect(req)) {
      return { _bm_response: true, status: 303, headers: { Location: redirectTo || '/' } };
    }
    const payload = { ok: true, user: { id: Number(user.id), email: user.email, super_admin: superAdmin }, redirect: redirectTo };
    if (this.wants_json(req)) {
      return { _bm_response: true, status: 200, json: payload };
    }
    return payload;
  }
}();
