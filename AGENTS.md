# Instructions

NO Typescript.
NO external dependencies (to much attacks in 2025)
Use Ecmascript module `import {} from "";`

## Libs

* create a test suite per lib in the lib folder

## Code style

Inspire from the simplicity and clarity of RAILS

## Environment variables

- All environment variables used by Black Mamba must be prefixed with `BM_`.
- Examples:
  - `BM_SESSION_SECRET`, `BM_SESSION_DB`
  - `BM_SMTP_HOST`, `BM_SMTP_PORT`, `BM_SMTP_USERNAME`, `BM_SMTP_PASSWORD`
- Do not introduce unprefixed env var names in new code.
