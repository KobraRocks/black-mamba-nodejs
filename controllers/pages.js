import { ApplicationController } from './application.js';

export const Pages = new class extends ApplicationController {
  resources = 'pages';

  // GET /pages → auto-renders views/pages/index.js
  index(_req, _res) { /* return nothing to trigger view */ }

  // GET /pages/:id → returns assigns for view
  show(req, _res) { return { title: 'Hello #' + req.params.id }; }

  constructor() {
    super();
    // Extra stable path that won't collide with RESTful :id
    this.custom_routes.add(['GET', 'index', 'index/view']); // /pages/index/view
  }
}();
