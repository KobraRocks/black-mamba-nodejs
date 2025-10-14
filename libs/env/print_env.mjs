import '../env/index.js';

const pick = (k) => (Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : null);
const out = {
  BM_PORT: pick('BM_PORT'),
  BM_DEV: pick('BM_DEV'),
  FOO: pick('FOO'),
};
console.log(JSON.stringify(out));

