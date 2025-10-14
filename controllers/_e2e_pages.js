import { ApplicationController } from './application.js';
export const PagesE2E = new class extends ApplicationController {
  resources = 'pages';
  // auto-render views/pages/index.js
  index(_req, _res) { /* return nothing */ }
  // return assigns for the view
  show(req, _res) { return { title: 'Hello #' + req.params.id }; }
  constructor() { super(); }
}();
