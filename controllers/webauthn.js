import '../libs/env/index.js';
import { ApplicationController } from './application.js';
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse } from '../libs/webauthn/index.js';
import { base64url } from '../libs/webauthn/base64url.js';

function rpFromEnv(req) {
  const host = req.headers['host'] || `localhost:${process.env.BM_PORT || 3000}`;
  const origin = `http://${host}`;
  const id = process.env.BM_RP_ID || host.split(':')[0];
  const name = process.env.BM_RP_NAME || 'Black Mamba';
  return { rp: { id, name }, origin };
}

export const WebAuthn = new class extends ApplicationController {
  namespace = 'auth';
  resources = 'webauthn';

  constructor() {
    super();
    this.custom_routes.add(['GET', 'register_options', 'register/options']);
    this.custom_routes.add(['POST', 'register_verify', 'register/verify']);
    this.custom_routes.add(['GET', 'login_options', 'login/options']);
    this.custom_routes.add(['POST', 'login_verify', 'login/verify']);
  }

  register_options(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const user = this.User.find(uid);
    const { rp } = rpFromEnv(req);
    const reg = generateRegistrationOptions(rp, { id: String(user.id), name: user.email, displayName: user.email });
    // Persist challenge for verification
    req.session.temp('webauthn_chal_reg', reg.challenge, 300);
    // Persist ephemeral challenge for next request
    try { req.session.save?.(); } catch {}
    if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
      console.log('[DEV][webauthn.register_options] user_id=%d challenge=%s', user.id, String(reg.challenge).slice(0, 8) + '...');
    }
    return { publicKey: { ...reg.publicKey, challenge: reg.challenge }, challenge: reg.challenge };
  }

  async register_verify(req, _res) {
    const uid = req.session?.getUserId();
    if (!uid) return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
    const user = this.User.find(uid);
    const { rp, origin } = rpFromEnv(req);
    const expected = req.session.temp('webauthn_chal_reg');
    if (!expected) return { _bm_response: true, status: 400, json: { ok: false, error: 'challenge-missing' } };
    const body = await req.body();
    try {
      const verified = await verifyRegistrationResponse(rp.id, origin, expected, body);
      const credId = verified.credentialId;
      let cred = this.WebauthnCredential.find_by({ credential_id: credId });
      if (!cred) {
        cred = this.WebauthnCredential.create({
          user_id: user.id,
          credential_id: credId,
          public_key: verified.publicKeyPem,
          sign_count: verified.signCount,
        });
      }
      if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
        console.log('[DEV][webauthn.register_verify] user_id=%d cred_id=%s sign=%d', user.id, credId.slice(0, 8) + '...', verified.signCount);
      }
      return { ok: true };
    } catch (e) {
      if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
        console.warn('[DEV][webauthn.register_verify] error: %s', e?.stack || e);
      }
      return { _bm_response: true, status: 400, json: { ok: false, error: String(e?.message || e) } };
    }
  }

  login_options(req, _res) {
    const email = req.url.searchParams.get('email');
    const uid = req.session?.getUserId();
    let user = null;
    if (uid) user = this.User.find(uid);
    if (!user && email) user = this.User.find_by({ email: String(email).toLowerCase().trim() });
    if (!user) return { _bm_response: true, status: 400, json: { ok: false, error: 'unknown-user' } };
    const { rp } = rpFromEnv(req);
    const creds = this.WebauthnCredential.where({ user_id: user.id });
    const allowCredentials = creds.map(c => ({ type: 'public-key', id: c.credential_id }));
    const auth = generateAuthenticationOptions(rp, []);
    req.session.temp('webauthn_chal_auth', auth.challenge, 300);
    try { req.session.save?.(); } catch {}
    // Return a minimal, JSON-friendly shape for the simulation
    if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
      console.log('[DEV][webauthn.login_options] user_id=%d challenge=%s allow=%d', user.id, String(auth.challenge).slice(0, 8) + '...', allowCredentials.length);
    }
    return { challenge: auth.challenge, allowCredentials, rpId: rp.id };
  }

  async login_verify(req, _res) {
    const body = await req.body();
    const { rp, origin } = rpFromEnv(req);
    const expected = req.session.temp('webauthn_chal_auth');
    if (!expected) return { _bm_response: true, status: 400, json: { ok: false, error: 'challenge-missing' } };
    // Identify which credential is used
    const credId = String(body.id || body.rawId || '').toString();
    const credB64 = base64url.encode(typeof body.rawId === 'string' ? base64url.decode(body.rawId) : Buffer.from(credId));
    const cred = this.WebauthnCredential.find_by({ credential_id: credB64 }) || this.WebauthnCredential.find_by({ credential_id: String(body.id || '') });
    if (!cred) return { _bm_response: true, status: 400, json: { ok: false, error: 'unknown-credential' } };
    try {
      const verified = await verifyAuthenticationResponse(rp.id, origin, expected, body, cred.public_key, cred.sign_count);
      // Update sign count
      this.WebauthnCredential.update(cred.id, { sign_count: verified.signCount });
      // Set session user
      let sessionStatus = 'guest';
      try {
        const BookingUser = this.BookingUser ?? this.model('booking_user');
        if (BookingUser) {
          const guest = BookingUser.statuses?.GUEST || 'guest';
          let profile = BookingUser.find_by?.({ user_id: cred.user_id });
          if (!profile) profile = BookingUser.create({ user_id: cred.user_id, status: guest });
          if (profile?.status) sessionStatus = profile.status;
        }
      } catch {}
      await req.session.setUser(cred.user_id);
      if (typeof req.session.setUserStatus === 'function') req.session.setUserStatus(sessionStatus);
      else req.session.set?.('user_status', sessionStatus);
      const redirectTo = this.consume_post_auth_redirect(req, { fallback: '/' });
      await req.session.save();
      const user = this.User.find(cred.user_id);
      if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
        console.log('[DEV][webauthn.login_verify] user_id=%d cred_id=%s sign=%d', user.id, String(cred.credential_id).slice(0,8)+'...', verified.signCount);
      }
      const payload = { ok: true, user: { id: Number(user.id), email: user.email }, redirect: redirectTo };
      if (this.wants_json(req)) {
        return { _bm_response: true, status: 200, json: payload };
      }
      return payload;
    } catch (e) {
      if (/^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''))) {
        console.warn('[DEV][webauthn.login_verify] error: %s', e?.stack || e);
      }
      return { _bm_response: true, status: 400, json: { ok: false, error: String(e?.message || e) } };
    }
  }
}();
