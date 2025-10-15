import { ApplicationController } from './application.js';

export const Me = new class extends ApplicationController {
  resources = 'me';

  index(req) {
    const uid = req.session?.getUserId();
    if (!uid) return this.unauthorized();

    const User = this.User ?? this.model('user');
    const user = User?.find?.(uid);
    if (!user) return this.unauthorized();

    const json = typeof user.toJSON === 'function' ? user.toJSON() : {};
    const id = Number(json.id ?? user.id);
    const email = json.email ?? user.email;
    const publicId = json.public_id ?? user.public_id;
    
    const sessionStatus = (() => {
      try {
        if (typeof req.session?.getUserStatus === 'function') return req.session.getUserStatus();
        return req.session?.get?.('user_status');
      } catch {
        return undefined;
      }
    })();

    const superAdmin = !!req.session?.get?.('super_admin');
    if (superAdmin) {
      const payload = { id: Number(user.id), email: user.email, super_admin: superAdmin };
      if (sessionStatus) payload.status = sessionStatus;
      return payload;
    }

    const payload = {
      id,
      email: typeof email === 'string' ? email : String(email ?? ''),
      public_id: typeof publicId === 'string' ? publicId : String(publicId ?? ''),
    };
    if (sessionStatus) payload.status = sessionStatus;
    return payload;

  }

  unauthorized() {
    return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
  }
}();
