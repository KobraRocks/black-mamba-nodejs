import { renderViewIfPresent } from '../libs/views/index.js';

export class ApplicationController {
  static modelRegistry = null;

  namespace = "";              //default
  resources = "";              //default
  resource = "";               //default
  has_many = new Set();        //default
  belongs_to = null;           //default
  before_handlers = new Set(); //default "authenticate"
  after_handlers = new Set();  //default
  custom_routes = new Set();   //default ["GET", "show", "/resources/:id/:user_id"]
  error = null;
  models = null;               // injected registry

  get has_namespace() { return this.namespace.length > 0; }
  get use_before() { return this.before_handlers.size > 0;}
  get use_after() { return this.after_handlers.size > 0;}
  get has_custom_routes() { return this.custom_routes.size > 0; }

  // Instance-level model resolver (works even before wiring, if static registry is set)
  model(key) {
    const reg = this.models || ApplicationController.modelRegistry;
    return reg?.get ? reg.get(key) : undefined;
  }

  // Inject model registry and expose Rails-like constants on the instance
  setModels(registry) {
    this.models = registry;
    ApplicationController.modelRegistry = registry;
    if (!registry) return this;
    // Attach by class name, e.g., this.User
    for (const name of Object.keys(registry.byName || {})) {
      // Do not override existing controller properties
      if (!(name in this)) this[name] = registry.byName[name];
    }
    return this;
  }

  before(request, response) {
      for (const handler of this.before_handlers) {
          try {
            // request object or response object can be increased by handlers;
            this[handler](request);
          } catch (err) {
            this.error = err;
            return this;
          }
      }

      return this;
  }

  after(request, response) {
    for (const handler of this.after_handlers) {
        try {
          handler(request, response);
        } catch (err) {
          this.error = err;
          return this;
        }
    }

    return this;
  }

  // Decide if the current request expects JSON over text
  wants_json(request) {
    try {
      const accept = String(request.headers?.accept || '').toLowerCase();
      if (accept.includes('application/json')) return true;

      const qp = request.url?.searchParams?.get('format');
      if (qp && String(qp).toLowerCase() === 'json') return true;
    } catch {}
    return false;
  }

  ensureBooker(request) {
    const session = request?.session;
    const unauthorized = { _bm_response: true, status: 401, text: 'Sign in required' };
    if (!session || typeof session.getUserId !== 'function' || !session.getUserId()) {
      return unauthorized;
    }
    let status = null;
    try {
      if (typeof session.getUserStatus === 'function') status = session.getUserStatus();
      else if (typeof session.get === 'function') status = session.get('user_status');
    } catch {}
    if (status !== 'booker') {
      return { _bm_response: true, status: 403, text: 'Booker access required' };
    }
    return null;
  }

  requireSuperAdmin(request) {
    const session = request?.session;
    const unauthorized = { _bm_response: true, status: 401, text: 'Sign in required' };
    if (!session || typeof session.getUserId !== 'function' || !session.getUserId()) {
      return unauthorized;
    }
    let isSuper = false;
    try {
      if (typeof session.get === 'function') {
        isSuper = !!session.get('super_admin');
      }
    } catch {}
    if (!isSuper) {
      return { _bm_response: true, status: 403, text: 'Super admin access required' };
    }
    return null;
  }

  index (request, response) {
    return response.status(405).send("Method not allowed");
  }
  new (request, response) {
    return response.status(405).send("Method not allowed");
  }
  create (request, response) {
    return response.status(405).send("Method not allowed");
  }
  show (request, response) {
    return response.status(405).send("Method not allowed");
  }
  edit (request, response) {
    return response.status(405).send("Method not allowed");
  }
  update (request, response) {
    return response.status(405).send("Method not allowed");
  }
  destroy (request, response) {
    return response.status(405).send("Method not allowed");
  }

  // Helper to request view rendering from an action.
  // Usage: return this.render(assigns) or this.render('show', assigns)
  render(actionOrAssigns, maybeAssigns) {
    if (typeof actionOrAssigns === 'string') {
      return { _bm_view: true, action: actionOrAssigns, assigns: maybeAssigns };
    }
    return { _bm_view: true, action: null, assigns: actionOrAssigns };
  }


  execute(action, request, response) {
    if (this.use_before) {
      const { error } = this.before(request, response);

      if (error) {
        response.error(error);
        return response.send();
      }
    }
    
    const maybe = this[action](request, response);

    const finalize = (result) => {
      if (this.use_after) {
        const { error } = this.after(request, response);

        if (error) {
          response.error(error);
          return response.send();
        }
      }

      // Allow actions to return a structured response descriptor
      if (result && typeof result === 'object' && result._bm_response === true) {
        const code = Number(result.status || 200);
        if (result.headers && typeof result.headers === 'object') {
          for (const [k, v] of Object.entries(result.headers)) response.header(k, v);
        }
        if (Object.prototype.hasOwnProperty.call(result, 'json')) return response.status(code).json(result.json);
        if (Object.prototype.hasOwnProperty.call(result, 'text')) return response.status(code).text(result.text);
        if (Object.prototype.hasOwnProperty.call(result, 'body')) return response.status(code).send(result.body);
        return response.status(code).send();
      }

      // Explicit view render request from action
      if (result && typeof result === 'object' && result._bm_view === true) {
        const act = result.action || action;
        Promise.resolve(renderViewIfPresent(this, act, request, response, result.assigns))
          .then((rendered) => { if (!rendered) response.status(404).text('View not found'); })
          .catch((err) => { try { response.error(err); } finally { response.send(); } });
        return;
      }

      // Prefer JSON when the client asks for it
      if (this.wants_json(request)) {
        return response.json(result);
      }

      // Auto-render view when an action returns nothing and a matching view exists.
      if (result === undefined || result === null) {
        // Fire and forget; renderViewIfPresent writes to response when present.
        Promise.resolve(renderViewIfPresent(this, action, request, response, undefined))
          .then((rendered) => { if (!rendered) response.send(result); })
          .catch(() => response.send(result));
        return;
      }

      // If a plain object/array is returned and JSON is not requested,
      // attempt to render a view using that object as assigns.
      if (typeof result === 'object' && !Buffer.isBuffer(result)) {
        Promise.resolve(renderViewIfPresent(this, action, request, response, result))
          .then((rendered) => { if (!rendered) response.send(result); })
          .catch(() => response.send(result));
        return;
      }

      return response.send(result);
    };

    // If the action is async, resolve it and then finalize
    if (maybe && typeof maybe.then === 'function') {
      maybe.then(finalize).catch((err) => {
        try { response.error(err); } finally { response.send(); }
      });
      return;
    }

    return finalize(maybe);
  }
}
