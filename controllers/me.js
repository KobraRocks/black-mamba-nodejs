import { ApplicationController } from './application.js';

export const Me = new class extends ApplicationController {
  resources = 'me';

  index(req) {
    const uid = req.session?.getUserId();
    if (!uid) return this.unauthorized();

    const User = this.User ?? this.model('user');
    const user = User?.find?.(uid);
    if (!user) return this.unauthorized();

    const superAdmin = !!req.session?.get?.('super_admin');
    return { id: Number(user.id), email: user.email, super_admin: superAdmin };
  }

  unauthorized() {
    return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
  }
}();
