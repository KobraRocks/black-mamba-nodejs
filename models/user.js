import { ApplicationRecord } from './application.js';

export class User extends ApplicationRecord {
  // resources inferred as 'users' from class name
}

// Define schema for the model
User.model = new ApplicationRecord.model.constructor({
  email: { type: 'string', mandatory: true },
});

// Consumers should call `User.migrate()` at bootstrapping time to ensure table exists.

