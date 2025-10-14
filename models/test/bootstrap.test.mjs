import test from 'node:test';
import assert from 'node:assert/strict';

import { ApplicationRecord } from '../application.js';
import { orderModels, modelDependencies } from '../bootstrap.js';

const Model = ApplicationRecord.model.constructor;

class Category extends ApplicationRecord {}
Category.model = new Model({
  name: { type: 'string', mandatory: true },
});

class Product extends ApplicationRecord {}
Product.model = new Model({
  name: { type: 'string', mandatory: true },
  category_id: { type: 'integer', reference: 'categories(id)' },
});

test('modelDependencies parses reference tables', () => {
  const deps = modelDependencies(Product);
  assert.ok(deps.has('categories'));
});

test('orderModels topologically orders by foreign key references', () => {
  const ordered = orderModels([Product, Category]).map(m => m.table);
  // Category should come before Product due to FK
  assert.equal(ordered[0], Category.table);
  assert.equal(ordered[1], Product.table);
});

