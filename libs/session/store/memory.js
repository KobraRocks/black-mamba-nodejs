export function MemoryStore() {
  const map = new Map();

  function now() { return Date.now(); }
  function gc() {
    const t = now();
    for (const [k, v] of map) if (v.exp && v.exp <= t) map.delete(k);
  }

  return {
    async get(id) { gc(); return map.get(id) || null; },
    async set(id, record) { map.set(id, record); },
    async destroy(id) { map.delete(id); },
    async touch(id, newExp) {
      const rec = map.get(id); if (!rec) return;
      rec.exp = newExp; map.set(id, rec);
    }
  };
}

