import { ApplicationController } from './application.js';

export const Users = new class extends ApplicationController {
  resources = 'users';

  // GET /users
  index(_req, _res) {
    return this.User.all({ order: 'id ASC' }).map(u => u.toJSON());
  }

  // GET /users/:id
  show(req, _res) {
    const id = Number(req.params.id);
    const user = this.User.find(id);
    if (!user) return { _bm_response: true, status: 404, json: { error: 'User not found' } };
    return user.toJSON();
  }

  // POST /users
  async create(req, _res) {
    const body = await req.body();
    const email = String(body?.email || '').trim().toLowerCase();
    const user = new this.User({ email });
    if (!user.save()) {
      return { _bm_response: true, status: 422, json: { errors: user.errors.fullMessages() } };
    }
    return { _bm_response: true, status: 201, json: user.toJSON() };
  }

  // PUT/PATCH /users/:id
  async update(req, _res) {
    const id = Number(req.params.id);
    const user = this.User.find(id);
    if (!user) return { _bm_response: true, status: 404, json: { error: 'User not found' } };
    const body = await req.body();
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      user.email = String(body.email || '').trim().toLowerCase();
    }
    if (!user.save()) {
      return { _bm_response: true, status: 422, json: { errors: user.errors.fullMessages() } };
    }
    return user.toJSON();
  }

  // DELETE /users/:id
  destroy(req, _res) {
    const id = Number(req.params.id);
    const user = this.User.find(id);
    if (!user) return { _bm_response: true, status: 404, json: { error: 'User not found' } };
    user.destroy();
    return { _bm_response: true, status: 204 };
  }
}();

