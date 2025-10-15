import { ApplicationController } from './application.js';

export const Things = new class extends ApplicationController {
  resources = 'things';

  index() {
    return 'hello';
  }

  show(req) {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return { _bm_response: true, status: 400, json: { error: 'invalid id' } };
    }
    return { id, name: 'Ada' };
  }
}();
