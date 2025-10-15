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

const controller = new SamplesController();

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-router-'));
const catalogPath = path.join(tmpRoot, 'route.catalog');

const router = new Router({ catalogPath });
router.register(controller);

const entries = fs.readFileSync(catalogPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);

assert.ok(entries.includes('GET /samples -> SamplesController#index'));
assert.ok(entries.includes('POST /samples -> SamplesController#create'));
assert.ok(entries.includes('GET /samples/featured -> SamplesController#featured'));

const routerAgain = new Router({ catalogPath });
routerAgain.register(controller);

const entriesAfterReset = fs.readFileSync(catalogPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);

assert.equal(entriesAfterReset.length, entries.length);
