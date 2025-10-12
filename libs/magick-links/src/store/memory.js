export function memoryStore() {
  const used = new Map(); // jti -> exp
  return {
    async markUsed(jti, exp) {
      if (used.has(jti)) return false;
      used.set(jti, exp);
      // GC occasionally
      if (used.size % 100 === 0) {
        const now = Math.floor(Date.now()/1000);
        for (const [k,v] of used.entries()) if (v < now) used.delete(k);
      }
      return true;
    },
    async isUsed(jti) { return used.has(jti); }
  };
}

