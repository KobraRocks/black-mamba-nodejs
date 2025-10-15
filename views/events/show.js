export default function ({ assigns }) {
  const e = assigns || {};
  return `<!doctype html><html><head><meta charset=\"utf-8\"><title>${e.name || 'Event'}</title></head><body>
  <h1>${e.name || 'Event'}</h1>
  <p>Duration: ${e.duration_min} min</p>
  </body></html>`;
}

