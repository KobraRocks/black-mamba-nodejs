// Minimal English inflector (pluralize) with common irregulars and uncountables
// ESM, no external deps. Keep small and predictable.

const UNCOUNTABLE = new Set([
  'equipment','information','rice','money','species','series','fish','sheep','news','feedback','baggage','furniture','advice','knowledge','water','sand','air'
]);

const IRREGULAR = new Map([
  ['person','people'],
  ['man','men'],
  ['woman','women'],
  ['child','children'],
  ['tooth','teeth'],
  ['foot','feet'],
  ['mouse','mice'],
  ['goose','geese'],
  ['ox','oxen'],
  ['die','dice'],
  ['index','indices'],
  ['matrix','matrices'],
  ['vertex','vertices'],
  ['quiz','quizzes'],
  ['octopus','octopi'],
  ['cactus','cacti'],
  ['focus','foci'],
  ['phenomenon','phenomena'],
  ['criterion','criteria'],
  ['analysis','analyses'],
  ['basis','bases'],
  ['diagnosis','diagnoses'],
  ['thesis','theses'],
  ['crisis','crises'],
  ['datum','data'],
]);

const O_ES = new Set(['hero','potato','tomato','echo','veto','torpedo']);
const F_TO_VES = new Set(['leaf','wolf','shelf','half','calf','loaf','thief','self','life','wife','knife']);

export function pluralize(word = '') {
  if (!word) return word;
  const lower = String(word).toLowerCase();
  if (UNCOUNTABLE.has(lower)) return lower;
  if (IRREGULAR.has(lower)) return IRREGULAR.get(lower);

  // Rules (order matters)
  // - ends with s, x, z, ch, sh => +es
  if (/(s|x|z|ch|sh)$/.test(lower)) return lower + 'es';
  // - words ending with 'y' preceded by a consonant => ies
  if (/[^aeiou]y$/.test(lower)) return lower.replace(/y$/, 'ies');
  // - knife/leaf/wolf -> knives/leaves/wolves (limited set to avoid overreach)
  if (F_TO_VES.has(lower)) return lower.replace(/f(e)?$/, 'ves');
  // - quiz -> quizzes (covered by irregular but kept)
  if (/quiz$/.test(lower)) return lower.replace(/z$/, 'zz') + 'es';
  // - ends with 'o'
  if (/o$/.test(lower)) {
    if (O_ES.has(lower)) return lower + 'es';
    return lower + 's';
  }
  return lower + 's';
}

export default { pluralize };
