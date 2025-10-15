import { ApplicationController } from './application.js';
import { User } from '../models/user.js';

export const Me = new class extends ApplicationController {
  resources = 'me';

  index(req, res) {
    const uid = req.session?.getUserId();
    if (!uid) return res.status(401).json({ error: 'unauthorized' });
    const user = User.find(uid);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    return { id: Number(user.id), email: user.email };
  }
}();
