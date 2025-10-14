// Example model demonstrating Rails-like conventions
import { ApplicationRecord } from './application.js';

export class User extends ApplicationRecord {
  // resources inferred as 'users' from class name
}

// Define schema for the model
User.model = new ApplicationRecord.model.constructor({
  email: { type: 'string', mandatory: true },
  name:  { type: 'string', default: '' },
  age:   { type: 'integer', default: 0 },
});

// Consumers should call `User.migrate()` at bootstrapping time to ensure table exists.

