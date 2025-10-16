import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Router } from '../router.js';
import { ApplicationController } from '../controllers/application.js';

class SamplesController extends ApplicationController {
  resources = 'samples';
  custom_routes = new Set([
    ['GET', 'featured', 'featured']
  ]);

  featured() {
    return { featured: true };
  }
}

class AdminReportsController extends ApplicationController {
  namespace = 'admin';
  resources = 'reports';
  routeRoot = 'reports';
  custom_routes = new Set([
    ['GET', 'stats', 'stats']
  ]);

  stats() {
    return { ok: true };
  }
}

const samples = new SamplesController();
const reports = new AdminReportsController();

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-router-'));
const catalogPath = path.join(tmpRoot, 'route.catalog');

const router = new Router({ catalogPath });
router.register(samples);
router.register(reports);

const entries = fs.readFileSync(catalogPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);

assert.ok(entries.includes('GET /samples -> SamplesController#index'));
assert.ok(entries.includes('POST /samples -> SamplesController#create'));
assert.ok(entries.includes('GET /samples/featured -> SamplesController#featured'));
assert.ok(entries.includes('GET /admin/reports -> AdminReportsController#index'));
assert.ok(entries.includes('GET /admin/reports/stats -> AdminReportsController#stats'));

const routerAgain = new Router({ catalogPath });
routerAgain.register(samples);
routerAgain.register(reports);

const entriesAfterReset = fs.readFileSync(catalogPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);

assert.equal(entriesAfterReset.length, entries.length);
