import test from 'node:test';
import assert from 'node:assert/strict';
import { pluralize } from './index.js';

const cases = [
  ['category', 'categories'],
  ['bus', 'buses'],
  ['class', 'classes'],
  ['box', 'boxes'],
  ['quiz', 'quizzes'],
  ['knife', 'knives'],
  ['leaf', 'leaves'],
  ['wolf', 'wolves'],
  ['hero', 'heroes'],
  ['potato', 'potatoes'],
  ['tomato', 'tomatoes'],
  ['child', 'children'],
  ['person', 'people'],
  ['mouse', 'mice'],
  ['analysis', 'analyses'],
  ['crisis', 'crises'],
  ['phenomenon', 'phenomena'],
  ['series', 'series'],
  ['fish', 'fish'],
  ['sheep', 'sheep'],
  ['feedback', 'feedback'],
  ['news', 'news'],
];

test('pluralize basic, irregular, and uncountable words', () => {
  for (const [singular, plural] of cases) {
    assert.equal(pluralize(singular), plural, singular);
  }
});

