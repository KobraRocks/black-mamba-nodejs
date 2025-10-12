import assert from 'node:assert/strict';
import { chooseEncoding, getCompressionConfig } from './index.js';

assert.equal(chooseEncoding(undefined), null);
assert.equal(chooseEncoding('identity'), null);
assert.equal(chooseEncoding('gzip, deflate, br'), 'br');
assert.equal(chooseEncoding('gzip, deflate'), 'gzip');
assert.equal(chooseEncoding('deflate'), 'deflate');
// prefer order respected
assert.equal(chooseEncoding('gzip, br', ['gzip','br']), 'gzip');
assert.equal(chooseEncoding('gzip;q=0.5, br;q=0.9', ['gzip','br']), 'br');

// config loads with defaults
const cfg = getCompressionConfig();
assert.ok(cfg && cfg.compression && typeof cfg.compression.threshold === 'number');

console.log('compression tests: OK');
