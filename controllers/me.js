import { ApplicationController } from './application.js';

export const Me = new class extends ApplicationController {
  resources = 'me';

  index(req) {
    const uid = req.session?.getUserId();
    if (!uid) return this.unauthorized();

    const User = this.User ?? this.model('user');
    const user = User?.find?.(uid);
    if (!user) return this.unauthorized();

    return { id: Number(user.id), email: user.email };
  }

  unauthorized() {
    return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
  }
}();
