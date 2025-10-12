import { createGzip, createDeflate, constants, createBrotliCompress } from 'node:zlib';
import { Transform } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = Object.freeze({
  enabled: true,
  threshold: 1024,
  prefer: ['br','gzip','deflate'],
  brotli: { quality: 4 },
  gzip: { level: 5 },
  deflate: { level: 5 },
  skip: {
    extensions: ['png','jpg','jpeg','gif','webp','avif','ico','mp4','webm','mov','m4v','mp3','wav','flac','zip','gz','pdf','woff','woff2','ttf'],
    contentTypes: ['image/*','video/*','audio/*','application/zip','application/gzip','application/octet-stream','application/pdf']
  }
});

let cachedConfig = null;
export function getCompressionConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    if (!fs.existsSync(cfgPath)) return (cachedConfig = { compression: { ...DEFAULTS } });
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    const user = raw.compression && typeof raw.compression === 'object' ? raw.compression : {};
    // Merge shallowly with defaults
    cachedConfig = { compression: {
      ...DEFAULTS,
      ...user,
      brotli: { ...DEFAULTS.brotli, ...(user.brotli || {}) },
      gzip: { ...DEFAULTS.gzip, ...(user.gzip || {}) },
      deflate: { ...DEFAULTS.deflate, ...(user.deflate || {}) },
      skip: {
        extensions: (user.skip && user.skip.extensions) || DEFAULTS.skip.extensions,
        contentTypes: (user.skip && user.skip.contentTypes) || DEFAULTS.skip.contentTypes
      }
    }};
    return cachedConfig;
  } catch {
    return (cachedConfig = { compression: { ...DEFAULTS } });
  }
}

export function chooseEncoding(acceptEncoding, preferOrder = DEFAULTS.prefer) {
  if (!acceptEncoding) return null;
  const tokens = String(acceptEncoding).toLowerCase().split(',').map(s => s.trim());
  const q = new Map();
  for (const t of tokens) {
    const [enc, ...params] = t.split(';').map(s => s.trim());
    let qv = 1;
    for (const p of params) {
      const [k, v] = p.split('=').map(s => s.trim());
      if (k === 'q') { const n = Number(v); if (!isNaN(n)) qv = n; }
    }
    q.set(enc, qv);
  }
  const supported = preferOrder.filter(enc => (q.get(enc) ?? -1) > 0);
  if (supported.length === 0) return null;
  // choose max q; tie-break by preferOrder
  let best = supported[0];
  for (const enc of supported) {
    const v = q.get(enc) ?? 0;
    const bestQ = q.get(best) ?? 0;
    if (v > bestQ) best = enc;
    else if (v === bestQ) {
      if (preferOrder.indexOf(enc) < preferOrder.indexOf(best)) best = enc;
    }
  }
  return best;
}

function isCompressible(contentType, urlPath = '', cfg = DEFAULTS) {
  const ext = (urlPath.split('.').pop() || '').toLowerCase();
  // Skip already-compressed or binary formats
  const skipExt = new Set(cfg.skip.extensions);
  if (skipExt.has(ext)) return false;

  if (!contentType) return true; // assume compressible for unknown types
  const ct = String(contentType).toLowerCase();
  if (ct.startsWith('text/')) return true;
  if (ct.includes('json')) return true;
  if (ct.includes('javascript')) return true;
  if (ct.includes('xml')) return true;
  if (ct === 'image/svg+xml') return true;
  for (const pattern of cfg.skip.contentTypes) {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      if (ct.startsWith(base + '/')) return false;
    } else if (ct.includes(pattern)) {
      return false;
    }
  }
  return true;
}

export function createCompression(req, res, options = {}) {
  const cfg = getCompressionConfig().compression;
  if (!cfg.enabled) return { stream: res, encoding: null };

  const threshold = options.threshold ?? cfg.threshold;
  const pref = options.encoding ?? chooseEncoding(req.headers['accept-encoding'], cfg.prefer);

  if (!pref) return { stream: res, encoding: null };

  let decided = false;
  let encoder = null;
  let total = 0;
  const buffer = [];

  function decide(final = false) {
    if (decided) return;
    decided = true;
    const ct = res.getHeader('Content-Type');
    const should = !final && isCompressible(ct, req.url, cfg);
    if (should) {
      // Add Vary header when compressing
      const prevVary = res.getHeader('Vary');
      if (!prevVary) res.setHeader('Vary', 'Accept-Encoding');
      else if (!String(prevVary).includes('Accept-Encoding')) res.setHeader('Vary', prevVary + ', Accept-Encoding');

      if (pref === 'br') encoder = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: cfg.brotli.quality } });
      else if (pref === 'gzip') encoder = createGzip({ level: cfg.gzip.level });
      else if (pref === 'deflate') encoder = createDeflate({ level: cfg.deflate.level });
    }

    if (encoder) {
      res.setHeader('Content-Encoding', pref);
      encoder.on('error', () => { try { res.end(); } catch {} });
      encoder.pipe(res);
      for (const ch of buffer) encoder.write(ch);
    } else {
      for (const ch of buffer) res.write(ch);
    }
  }

  const t = new Transform({ transform(chunk, _enc, cb) {
    if (!decided) {
      total += chunk.length;
      buffer.push(chunk);
      if (total >= threshold) decide(false);
      return cb();
    }
    if (encoder) encoder.write(chunk, _enc, cb);
    else res.write(chunk, _enc, cb);
  }, flush(cb) {
    // Decide at flush-time; if below threshold, no compression
    decide(true);
    if (encoder) encoder.end();
    else res.end();
    cb();
  }});

  return { stream: t, encoding: pref };
}

export { isCompressible };
