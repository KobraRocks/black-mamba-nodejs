import { ApplicationController } from './application.js';
import { featureDefinitions, featuresForUser } from '../libs/features/index.js';

function lookupModel(controller, key) {
  if (!key) return undefined;
  const normalized = String(key);
  const pascal = normalized.replace(/(^|_)(\w)/g, (_, __, chr) => chr.toUpperCase());
  if (controller[pascal]) return controller[pascal];
  if (typeof controller.model === 'function') return controller.model(normalized);
  return undefined;
}

export const Me = new class extends ApplicationController {
  resources = 'me';

  index(req) {
    const uid = req.session?.getUserId();
    if (!uid) return this.unauthorized();

    const User = this.User ?? this.model('user');
    const user = User?.find?.(uid);
    if (!user) return this.unauthorized();

    const json = typeof user.toJSON === 'function' ? user.toJSON() : {};
    const id = Number(json.id ?? user.id);
    const email = json.email ?? user.email;
    const publicId = json.public_id ?? user.public_id;
    
    const sessionStatus = (() => {
      try {
        if (typeof req.session?.getUserStatus === 'function') return req.session.getUserStatus();
        return req.session?.get?.('user_status');
      } catch {
        return undefined;
      }
    })();

    const superAdmin = !!req.session?.get?.('super_admin');
    const getModel = (key) => lookupModel(this, key);
    const definitions = featureDefinitions({ getModel });
    const features = featuresForUser({
      userId: id,
      sessionStatus,
      getModel,
      definitions,
    });

    const basePayload = {
      id,
      email: typeof email === 'string' ? email : String(email ?? ''),
      public_id: typeof publicId === 'string' ? publicId : String(publicId ?? ''),
    };
    if (sessionStatus) basePayload.status = sessionStatus;
    if (features.length) basePayload.features = features;

    if (superAdmin) {
      return { ...basePayload, super_admin: true };
    }

    return basePayload;

  }

  unauthorized() {
    return { _bm_response: true, status: 401, json: { error: 'unauthorized' } };
  }
}();
