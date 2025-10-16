import fs from 'node:fs';
import path from 'node:path';

function createPathPattern(route) {
  // Convert '/users/:id/edit' to regex with named groups
  const reStr = '^' + route
    .replace(/\//g, '\\/')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '(?<$1>[^\/]+)') + '\/?$';
  const regex = new RegExp(reStr);
  return {
    test: (pathname) => regex.test(pathname),
    exec: (pathname) => ({ pathname: { groups: (regex.exec(pathname)?.groups) || {} } })
  };
}

function normalizeRouteRoot(routeRoot) {
  if (routeRoot == null) return '';
  let root = String(routeRoot).trim();
  if (!root) return '';
  if (!root.startsWith('/')) root = `/${root}`;
  root = root.replace(/\/+$/, '');
  return root || '/';
}

export class Router {
  #store = new Map();
  #catalogPath = path.resolve(process.cwd(), 'route.catalog');
  #catalog = [];

  constructor(options = {}) {
    if (options.catalogPath) this.#catalogPath = path.resolve(options.catalogPath);
    const dir = path.dirname(this.#catalogPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#catalogPath, '', 'utf8');
  }

  #recordRoute(method, route, action, controller) {
    const controllerName = controller?.constructor?.name || controller?.resources || 'controller';
    const entry = `${method} ${route} -> ${controllerName}#${action}`;
    this.#catalog.push(entry);
    fs.appendFileSync(this.#catalogPath, `${entry}\n`, 'utf8');
  }

  #register(route, action, method, controller) {
    const pattern = createPathPattern(route);
    if (!this.#store.has(method)) this.#store.set(method, new Map());
    this.#store.get(method).set(pattern, controller.execute.bind(controller, action));
    this.#recordRoute(method, route, action, controller);
  }

  register(controller) {
    const resources = controller.resources;
    const namespace = controller.namespace ? String(controller.namespace).toLowerCase() : '';
    const namespacePrefix = namespace ? `/${namespace}` : '';
    const overrideRoot = normalizeRouteRoot(controller.routeRoot);

    let root;
    if (overrideRoot) {
      if (namespacePrefix && !overrideRoot.startsWith(namespacePrefix)) {
        const suffix = overrideRoot === '/' ? '' : overrideRoot;
        root = `${namespacePrefix}${suffix}` || namespacePrefix;
      } else {
        root = overrideRoot;
      }
    } else {
      root = namespacePrefix ? `${namespacePrefix}/${resources}` : `/${resources}`;
    }

    if (!overrideRoot && controller.belongs_to) {
      const parent = controller.belongs_to; // name of parent resources
      const parentSingular = parent.endsWith('s') ? parent.slice(0, -1) : parent;
      root = `/${parent}/:${parentSingular}_id/${resources}`;
    }

    // Register custom routes first so they take precedence over generic ":id" matches
    if (controller.has_custom_routes) {
      for (const r of controller.custom_routes) {
        // Expect entries like [method, action, path]
        if (Array.isArray(r) && r.length === 3) {
          const [method, action, routePath] = r;
          const full = routePath.startsWith('/') ? routePath : `${root}/${routePath}`;
          this.#register(full, action, method.toUpperCase(), controller);
        }
      }
    }

    this.#register(root, 'index', 'GET', controller);
    this.#register(`${root}/new`, 'new', 'GET', controller);
    this.#register(root, 'create', 'POST', controller);
    this.#register(`${root}/:id`, 'show', 'GET', controller);
    this.#register(`${root}/:id/edit`, 'edit', 'GET', controller);
    this.#register(`${root}/:id`, 'update', 'PUT', controller);
    this.#register(`${root}/:id`, 'update', 'PATCH', controller);
    this.#register(`${root}/:id`, 'destroy', 'DELETE', controller);
  }

  register_all(controllers) {
    const orderedControllers = controllers.order();
    for (const [, controller] of orderedControllers) {
      this.register(controller);
    }
  }

  #handle_static(request, response) {
    const pathname = request.url.pathname;
    const publicRoot = path.resolve(process.cwd(), 'public');
    let filePath = pathname === '/' ? path.join(publicRoot, 'index.html') : path.join(publicRoot, pathname);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(publicRoot)) return false; // protect against traversal

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return false;
      const ext = path.extname(resolved).toLowerCase();
      const mime = this.#mime(ext);
      response.status(200).header('Content-Type', mime);
      const stream = fs.createReadStream(resolved);
      stream.pipe(response.raw);
      stream.on('end', () => response.raw.end());
      return true;
    } catch {
      return false;
    }
  }

  #mime(ext) {
    switch (ext) {
      case '.html': return 'text/html; charset=utf-8';
      case '.css': return 'text/css; charset=utf-8';
      case '.js': return 'application/javascript; charset=utf-8';
      case '.json': return 'application/json; charset=utf-8';
      case '.svg': return 'image/svg+xml';
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.gif': return 'image/gif';
      case '.ico': return 'image/x-icon';
      default: return 'application/octet-stream';
    }
  }

  handle(request, response) {
    const pathname = request.url.pathname;
    const method = request.method;
    const methodStore = this.#store.get(method);

    if (method === 'GET' && pathname === '/__up') {
      return response.status(200).text('ok');
    }

    const tryHandleRoute = () => {
      if (!methodStore || methodStore.size === 0) return false;
      for (const [pattern, handler] of methodStore) {
        if (!pattern.test(pathname)) continue;
        const match = pattern.exec(pathname);
        request.params = match.pathname.groups;
        handler(request, response);
        return true;
      }
      return false;
    };

    if (method === 'GET' && pathname === '/') {
      if (tryHandleRoute()) return;
      if (this.#handle_static(request, response)) return;
      return response.status(404).send('Not Found');
    }

    if (this.#handle_static(request, response)) return;

    if (tryHandleRoute()) return;

    return response.status(404).send('Not Found');
  }
}
