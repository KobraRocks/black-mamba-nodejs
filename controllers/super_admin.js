import { ApplicationController } from './application.js';
import { featureDefinitions, labelForRole } from '../libs/features/index.js';

function lookupModel(controller, key) {
  if (!key) return undefined;
  const normalized = String(key);
  const pascal = normalized.replace(/(^|_)(\w)/g, (_, __, chr) => chr.toUpperCase());
  if (controller[pascal]) return controller[pascal];
  if (typeof controller.model === 'function') return controller.model(normalized);
  return undefined;
}

export const SuperAdmin = new class extends ApplicationController {
  resources = 'super_admin';

  constructor() {
    super();
    this.custom_routes.add(['GET', 'stats', 'stats']);
    this.custom_routes.add(['GET', 'users', 'users']);
    this.custom_routes.add(['PATCH', 'update_role', 'users/:id/features/:feature']);
    this.custom_routes.add(['POST', 'update_role', 'users/:id/features/:feature']);
  }

  index(req, _res) {
    const guard = this.requireSuperAdmin(req);
    if (guard) return guard;
    const payload = this.buildDashboardPayload();
    if (this.wants_json(req)) return payload;
    return this.render({
      dashboard: payload,
      pageTitle: 'Super Admin',
    });
  }

  users(req, _res) {
    const guard = this.requireSuperAdmin(req);
    if (guard) return guard;
    const { features, users } = this.buildDashboardPayload();
    return { features, users };
  }

  stats(req, _res) {
    const guard = this.requireSuperAdmin(req);
    if (guard) return guard;
    const { stats } = this.buildDashboardPayload();
    return stats;
  }

  async update_role(req, _res) {
    const guard = this.requireSuperAdmin(req);
    if (guard) return guard;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { _bm_response: true, status: 400, json: { error: 'Invalid user id' } };
    }
    const featureKey = String(req.params.feature || '').trim().toLowerCase();
    if (!featureKey) {
      return { _bm_response: true, status: 404, json: { error: 'Feature not found' } };
    }
    const body = await req.body();
    const desiredRole = String(body?.role || body?.status || '').trim().toLowerCase();
    if (!desiredRole) {
      return { _bm_response: true, status: 422, json: { error: 'Role is required' } };
    }

    const features = this.featureDefinitions();
    const feature = features.find(f => f.key === featureKey);
    if (!feature) {
      return { _bm_response: true, status: 404, json: { error: 'Feature not found' } };
    }
    const allowed = new Set(feature.roles.map(r => r.key));
    if (!allowed.has(desiredRole)) {
      return { _bm_response: true, status: 422, json: { error: 'Role not allowed' } };
    }

    const User = this.User ?? this.model('user');
    const user = User?.find?.(id);
    if (!user) {
      return { _bm_response: true, status: 404, json: { error: 'User not found' } };
    }

    try {
      feature.applyRole(id, desiredRole);
    } catch (err) {
      return { _bm_response: true, status: 500, json: { error: err?.message || 'Unable to update role' } };
    }

    const payload = this.buildDashboardPayload();
    const updatedUser = payload.users.find(u => Number(u.id) === Number(id));

    return {
      _bm_response: true,
      status: 200,
      json: {
        ok: true,
        feature: feature.key,
        user: updatedUser,
        stats: payload.stats,
      },
    };
  }

  buildDashboardPayload() {
    const features = this.featureDefinitions();
    const assignments = this.collectFeatureAssignments(features);
    const users = this.serializeUsers(features, assignments);
    const stats = this.computeStats(features, users);
    return { features, users, stats, generated_at: new Date().toISOString() };
  }

  featureDefinitions() {
    return featureDefinitions({ getModel: (key) => lookupModel(this, key) });
  }

  collectFeatureAssignments(features) {
    const assignments = new Map();
    for (const feature of features) {
      try {
        const map = feature.collectAssignments?.();
        if (map instanceof Map) assignments.set(feature.key, map);
        else if (map && typeof map === 'object') assignments.set(feature.key, new Map(Object.entries(map)));
        else assignments.set(feature.key, new Map());
      } catch {
        assignments.set(feature.key, new Map());
      }
    }
    return assignments;
  }

  serializeUsers(features, assignments) {
    const User = this.User ?? this.model('user');
    const list = User?.order?.('email ASC') ?? [];
    return list.map((user) => this.serializeUserRecord(user, features, assignments));
  }

  serializeUserRecord(user, features, assignments) {
    const id = Number(user?.id);
    const email = String(user?.email || '');
    const featureState = {};
    for (const feature of features) {
      const store = assignments.get(feature.key) || new Map();
      const role = store.get(id) || feature.defaultRole;
      featureState[feature.key] = {
        role,
        label: labelForRole(feature, role),
      };
    }
    return { id, email, features: featureState };
  }

  computeStats(features, users) {
    const cards = [];
    const breakdowns = {};
    const totals = { users: users.length };
    cards.push({ key: 'users', label: 'Total users', value: totals.users });

    for (const feature of features) {
      const counts = new Map();
      for (const user of users) {
        const detail = user.features?.[feature.key];
        const role = detail?.role || feature.defaultRole;
        counts.set(role, (counts.get(role) || 0) + 1);
      }
      if (feature.collectMetrics) {
        try {
          const metrics = feature.collectMetrics();
          if (metrics && typeof metrics === 'object') {
            if (Number.isFinite(metrics.eventTypes)) {
              cards.push({ key: `${feature.key}_event_types`, label: `${feature.name} event types`, value: metrics.eventTypes });
            }
            if (Number.isFinite(metrics.totalBookings)) {
              cards.push({ key: `${feature.key}_bookings`, label: `${feature.name} bookings`, value: metrics.totalBookings });
            }
          }
        } catch {}
      }
      breakdowns[feature.key] = {
        label: feature.name,
        description: feature.description,
        roles: feature.roles.map(option => ({
          key: option.key,
          label: option.label,
          count: counts.get(option.key) || 0,
        })),
      };
    }

    return { cards, breakdowns };
  }
}();
