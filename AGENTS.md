# Instructions

NO Typescript.
NO external dependencies (to much attacks in 2025)
Use Ecmascript module `import {} from "";`

## Libs

* create a test suite per lib in the lib folder

## Code style

Inspire from the simplicity and clarity of RAILS

## Environment variables

* All environment variables used by Black Mamba must be prefixed with `BM_`.
* Examples:
* `BM_SESSION_SECRET`, `BM_SESSION_DB, BM_SMTP_HOST`, `BM_SMTP_PORT`, `BM_SMTP_USERNAME`, `BM_SMTP_PASSWORD`
* Do not introduce unprefixed env var names in new code.
* when adding new env variable update .env.template file

## Simulation

In `simulation/` folder we test E2E scenario by running the server to test prod like scenario.
Each new feature must be included in scenario.

## Application Controllers

The ApplicationController class implements for instances `instance.execute()` called internally to execute the action controller method, get the result and eventually pass it to a view.
A good example of a controller implementation is controllers/users.js

## CSS style

* main css file is in public/styles.css
* use nested properties first
* assign classes only when it make sense
* use :root {} to parameter variables
* for colors use --color-primary, --color-secondary, --color-accent, --color-highlight.
