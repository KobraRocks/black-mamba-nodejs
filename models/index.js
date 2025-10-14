import { loadModels } from './bootstrap.js';

// Build a registry of models so controllers can access them like Rails constants
// Exposes byName (e.g., { User }), byTable (e.g., { users: User }), and a helper lookup.
export async function buildModelRegistry() {
  const classes = await loadModels();
  const byName = Object.create(null);
  const byTable = Object.create(null);

  for (const cls of classes) {
    const name = cls?.name;
    if (!name) continue;
    byName[name] = cls;
    if (cls.table) byTable[String(cls.table)] = cls;
  }

  function get(model) {
    if (!model) return undefined;
    if (typeof model === 'function') return model;
    if (byName[model]) return byName[model];
    const lower = String(model).toLowerCase();
    // try table name directly
    if (byTable[lower]) return byTable[lower];
    // basic singular/plural heuristics
    const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
    const plural = lower.endsWith('s') ? lower : `${lower}s`;
    if (byTable[singular]) return byTable[singular];
    if (byTable[plural]) return byTable[plural];
    // try PascalCase class name from lower variants
    const pascal = singular.replace(/(^|_|\-|\s)\w/g, (m) => m.replace(/[_\-\s]/g, '').toUpperCase());
    if (byName[pascal]) return byName[pascal];
    return undefined;
  }

  return { byName, byTable, get };
}

