export class ApplicationController {

  namespace = "";              //default
  resources = "";              //default
  resource = "";               //default
  has_many = new Set();        //default
  belongs_to = null;           //default
  before_handlers = new Set(); //default "authenticate"
  after_handlers = new Set();  //default
  custom_routes = new Set();   //default ["GET", "show", "/resources/:id/:user_id"]
  error = null;

  get has_namespace() { return this.namespace.length > 0; }
  get use_before() { return this.before_handlers.size > 0;}
  get use_after() { return this.after_handlers.size > 0;}
  get has_custom_routes() { return this.custom_routes.size > 0; }

  before(request, response) {
      for (const handler of this.before_handlers) {
          try {
            // request object or response object can be increased by handlers;
            this.[handler](request);
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

    return response.send(result);
  }
}
