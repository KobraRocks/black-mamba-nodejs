import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ApplicationRecord } from './application.js';

function isSubclassOfApplicationRecord(val) {
  if (typeof val !== 'function') return false;
  if (val === ApplicationRecord) return false;
  // class inheritance chain: Object.getPrototypeOf(Sub) === Super
  let p = Object.getPrototypeOf(val);
  while (p && p !== Function.prototype) {
    if (p === ApplicationRecord) return true;
    p = Object.getPrototypeOf(p);
  }
  return false;
}

export async function loadModels() {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const modelsDir = rootDir; // current folder
  const out = [];
  const toVisit = [modelsDir];
  while (toVisit.length) {
    const dir = toVisit.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test') continue;
        toVisit.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.js')) continue;
      if (entry.name === 'application.js') continue;
      try {
        const mod = await import(pathToFileURL(full).href);
        for (const key of Object.keys(mod)) {
          const val = mod[key];
          if (isSubclassOfApplicationRecord(val)) out.push(val);
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return out;
}

function parseReferenceTable(ref) {
  if (!ref) return '';
  const m = String(ref).match(/([a-zA-Z0-9_]+)[\.\(]([a-zA-Z0-9_]+)\)?/);
  return m ? m[1] : '';
}

export function modelDependencies(ModelClass) {
  const deps = new Set();
  const entries = ModelClass.model?.entries?.() || [];
  for (const [, prop] of entries) {
    const tbl = parseReferenceTable(prop.reference);
    if (tbl) deps.add(tbl);
  }
  return deps;
}

export function orderModels(models) {
  // Build nodes
  const nodes = new Map(); // table -> { cls, dependsOn:Set, indeg:number }
  for (const cls of models) {
    const table = cls.table;
    nodes.set(table, { cls, table, dependsOn: new Set(), indeg: 0 });
  }
  // Populate dependencies (filter to known tables)
  for (const { cls, table } of nodes.values()) {
    const deps = modelDependencies(cls);
    for (const dep of deps) if (nodes.has(dep)) nodes.get(table).dependsOn.add(dep);
  }
  // Build dependents adjacency
  const dependents = new Map(); // table -> Set of tables that depend on it
  for (const [table, node] of nodes.entries()) {
    node.indeg = node.dependsOn.size;
    for (const dep of node.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(table);
    }
  }
  // Kahn's algorithm
  const queue = [];
  for (const n of nodes.values()) if (n.indeg === 0) queue.push(n);
  const ordered = [];
  while (queue.length) {
    const n = queue.shift();
    ordered.push(n.cls);
    const ds = dependents.get(n.table) || new Set();
    for (const depTable of ds) {
      const dn = nodes.get(depTable);
      if (!dn) continue;
      dn.indeg -= 1;
      if (dn.indeg === 0) queue.push(dn);
    }
  }
  if (ordered.length !== nodes.size) {
    for (const n of nodes.values()) if (!ordered.includes(n.cls)) ordered.push(n.cls);
  }
  return ordered;
}

export async function migrateAll(logger = console) {
  const models = await loadModels();
  const ordered = orderModels(models);
  for (const M of ordered) {
    try {
      M.migrate();
      logger?.log?.(`migrated ${M.table}`);
    } catch (e) {
      logger?.error?.(`failed to migrate ${M.table}: ${e?.message || e}`);
      throw e;
    }
  }
  return ordered.map(m => m.table);
}
