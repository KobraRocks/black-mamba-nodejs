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


  execute(action, request, response) {
    if (this.use_before) {
      const { error } = this.before(request, response);

      if (error) {
        response.error(error);
        return response.send();
      }
    }
    
    const result = this[action](request, response);

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

    // Prefer JSON when the client asks for it
    if (this.wants_json(request)) {
      return response.json(result);
    }

    return response.send(result);
  }
}
