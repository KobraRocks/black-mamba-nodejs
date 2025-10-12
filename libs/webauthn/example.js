import * as webauthn from './index.js';

const rp = { name: 'Example Corp', id: 'example.com' };
const user = { id: 'user1', name: 'alice', displayName: 'Alice Example' };

const regOpts = webauthn.generateRegistrationOptions(rp, user);
console.log('Registration Options:', {
  rp: regOpts.publicKey.rp,
  user: { name: regOpts.publicKey.user.name, displayName: regOpts.publicKey.user.displayName },
  challenge: String(regOpts.challenge).slice(0, 8) + '...'
});
