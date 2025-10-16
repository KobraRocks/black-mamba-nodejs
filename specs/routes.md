# Route Reference

This document summarizes the HTTP routes that Black Mamba exposes. Run `npm start` to regenerate `route.catalog` whenever routes change. Each entry explains what the endpoint does and when to call it while building features or linking views.

## Pages

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /pages/index/view | pages#index | Stable alias that renders the landing view when you need to link to the default page without conflicting with `/pages/:id`. |
| GET | /pages | pages#index | Renders the generic pages index; use for navigation to the main marketing page. |
| GET | /pages/new | pages#new | Reserved for a future page-creation form. Currently returns HTTP 405. |
| POST | /pages | pages#create | Reserved for future CMS-style page creation. Currently returns HTTP 405. |
| GET | /pages/:id | pages#show | Displays an ad-hoc page by ID; handy for smoke tests or demo content that needs an identifier. |
| GET | /pages/:id/edit | pages#edit | Placeholder for editing static pages. Currently returns HTTP 405. |
| PUT | /pages/:id | pages#update | Placeholder for updating static pages. Currently returns HTTP 405. |
| PATCH | /pages/:id | pages#update | Placeholder for updating static pages via partial updates. Currently returns HTTP 405. |
| DELETE | /pages/:id | pages#destroy | Placeholder for deleting static pages. Currently returns HTTP 405. |

## Magic Links Authentication (`/auth/magic`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| POST | /auth/magic/request | magic#request_link | Generates and emails (or logs in dev mode) a magic sign-in link; call after collecting the user email. |
| GET | /auth/magic/callback | magic#callback | Consumes a magic link token, signs the user in, and redirects/returns JSON. Use as the magic link destination. |
| GET | /auth/magic | magic#index | Serves the magic link request page; link users here if they need to request a login link. |
| GET | /auth/magic/new | magic#new | Provides assigns for the request view; typically reached via `/auth/magic`. |
| POST | /auth/magic | magic#create | Reserved for REST-style creation. Currently returns HTTP 405; use `/auth/magic/request` instead. |
| GET | /auth/magic/:id | magic#show | Placeholder for inspecting a stored magic link request. Currently returns HTTP 405. |
| GET | /auth/magic/:id/edit | magic#edit | Placeholder for editing a stored magic link configuration. Currently returns HTTP 405. |
| PUT | /auth/magic/:id | magic#update | Placeholder for updating a stored magic link configuration. Currently returns HTTP 405. |
| PATCH | /auth/magic/:id | magic#update | Placeholder for updating a stored magic link configuration. Currently returns HTTP 405. |
| DELETE | /auth/magic/:id | magic#destroy | Placeholder for deleting a stored magic link configuration. Currently returns HTTP 405. |

## Booking Pages (`/booking`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /booking/:booker_public_id/:slug | booking#page | Public scheduling page for an event type; link invitees here to pick a slot. |
| GET | /booking/:booker_public_id/:slug/contact | booking#contact | Displays the confirmation form once an invitee selects a slot; use for multi-step booking flows. |
| POST | /booking/:booker_public_id/:slug/contact | booking#submit | Creates a booking, sends notifications, and renders confirmation; post the invitee’s details and selected slot here. |
| GET | /booking/management | booking#management | Organizer dashboard that surfaces event types and booking links; requires a booker session. |
| GET | /booking | booking#index | Reserved for listing booking pages. Currently returns HTTP 405. |
| GET | /booking/new | booking#new | Reserved for future booking page creation. Currently returns HTTP 405. |
| POST | /booking | booking#create | Reserved for future booking page creation. Currently returns HTTP 405. |
| GET | /booking/:id | booking#show | Placeholder for retrieving booking page metadata by ID. Currently returns HTTP 405. |
| GET | /booking/:id/edit | booking#edit | Placeholder for editing booking pages. Currently returns HTTP 405. |
| PUT | /booking/:id | booking#update | Placeholder for updating booking pages. Currently returns HTTP 405. |
| PATCH | /booking/:id | booking#update | Placeholder for partially updating booking pages. Currently returns HTTP 405. |
| DELETE | /booking/:id | booking#destroy | Placeholder for deleting booking pages. Currently returns HTTP 405. |

## Event Bookings (`/event_bookings`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /event_bookings/cancel | event_bookings#cancel | Self-service cancellation endpoint for invitees holding a signed cancel token. Link from emails. |
| GET | /event_bookings/management | event_bookings#management | Organizer view showing upcoming bookings tied to their event types. Requires booker access. |
| GET | /event_bookings | event_bookings#index | Lists bookings for the signed-in organizer; supports `event_type_id` filtering. Use for management UIs. |
| GET | /event_bookings/new | event_bookings#new | Reserved for a booking creation form. Currently returns HTTP 405. |
| POST | /event_bookings | event_bookings#create | API for creating bookings programmatically (used by booking flow). Expects event type and invitee details. |
| GET | /event_bookings/:id | event_bookings#show | Placeholder for retrieving a single booking. Currently returns HTTP 405. |
| GET | /event_bookings/:id/edit | event_bookings#edit | Placeholder for editing bookings via HTML. Currently returns HTTP 405. |
| PUT | /event_bookings/:id | event_bookings#update | Organizer API for rescheduling or updating booking status; requires ownership. |
| PATCH | /event_bookings/:id | event_bookings#update | Same as PUT but for partial updates. |
| DELETE | /event_bookings/:id | event_bookings#destroy | Organizer API for cancelling bookings outright. |

## Event Types (`/events`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /events/:id/slots | events#slots | Returns available UTC slots for a specific event type ID; use for organizer tools. |
| GET | /events/s/:slug | events#show_slug | Fetches event type details by public slug; helpful when linking from booking pages. |
| GET | /events/s/:slug/slots | events#slots_slug | Slot lookup by slug, mirroring `/events/:id/slots` for public contexts. |
| POST | /events/:id/edit | events#update | HTML-friendly update endpoint that accepts form submissions from the edit view. |
| GET | /events/management | events#management | Organizer management view listing their event types. Requires booker permissions. |
| GET | /events | events#index | Lists event types; pass `?mine=1` to limit to the signed-in organizer. |
| GET | /events/new | events#new | Renders the new event type form for organizers. |
| POST | /events | events#create | Creates a new event type for the signed-in organizer and upgrades their role if needed. |
| GET | /events/:id | events#show | Returns JSON for an event type by numeric ID. |
| GET | /events/:id/edit | events#edit | Provides assigns for the edit view of an event type. |
| PUT | /events/:id | events#update | API for updating an existing event type (JSON payload expected). |
| PATCH | /events/:id | events#update | Partial update variant for event types. |
| DELETE | /events/:id | events#destroy | Deletes an event type owned by the signed-in organizer. |

## Current User (`/me`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /me | me#index | Returns the session user’s profile summary (id, email, public_id, status). Use for “who am I?” checks. A list of features the userhas access |
| GET | /me/new | me#new | Reserved for future account creation flow. Currently returns HTTP 405. |
| POST | /me | me#create | Reserved for future account creation flow. Currently returns HTTP 405. |
| GET | /me/:id | me#show | Placeholder for fetching other profiles. Currently returns HTTP 405. |
| GET | /me/:id/edit | me#edit | Placeholder for profile editing UI. Currently returns HTTP 405. |
| PUT | /me/:id | me#update | Placeholder for updating profile data. Currently returns HTTP 405. |
| PATCH | /me/:id | me#update | Placeholder for partially updating profile data. Currently returns HTTP 405. |
| DELETE | /me/:id | me#destroy | Placeholder for deleting a profile. Currently returns HTTP 405. |

## Sign-in (`/signin`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /signin | signin#index | Presents the combined magic link/passkey sign-in screen and stores `next` redirect hints. |
| GET | /signin/new | signin#new | Reserved for REST-style sign-in creation. Currently returns HTTP 405. |
| POST | /signin | signin#create | Reserved for REST-style sign-in submission. Currently returns HTTP 405. |
| GET | /signin/:id | signin#show | Placeholder for session inspection. Currently returns HTTP 405. |
| GET | /signin/:id/edit | signin#edit | Placeholder for editing sessions. Currently returns HTTP 405. |
| PUT | /signin/:id | signin#update | Placeholder for updating sessions. Currently returns HTTP 405. |
| PATCH | /signin/:id | signin#update | Placeholder for updating sessions. Currently returns HTTP 405. |
| DELETE | /signin/:id | signin#destroy | Placeholder for deleting sessions. Currently returns HTTP 405. |

## Super Admin (`/super_admin`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /super_admin/stats | super_admin#stats | Returns aggregate metrics for enabled features (e.g., booking counts); use for dashboards. |
| GET | /super_admin/users | super_admin#users | Returns users plus their feature roles for administrative tooling. |
| PATCH | /super_admin/users/:id/features/:feature | super_admin#update_role | Updates a user’s role for a specific feature; send JSON `{ role }`. |
| POST | /super_admin/users/:id/features/:feature | super_admin#update_role | HTML form compatible variant of the role update endpoint. |
| GET | /super_admin | super_admin#index | Renders the main super admin dashboard (JSON or HTML depending on Accept header). |
| GET | /super_admin/new | super_admin#new | Reserved for creating super-admin records. Currently returns HTTP 405. |
| POST | /super_admin | super_admin#create | Reserved for provisioning super-admin records. Currently returns HTTP 405. |
| GET | /super_admin/:id | super_admin#show | Placeholder for inspecting a single super admin record. Currently returns HTTP 405. |
| GET | /super_admin/:id/edit | super_admin#edit | Placeholder for editing super admin records. Currently returns HTTP 405. |
| PUT | /super_admin/:id | super_admin#update | Placeholder for updating super admin records. Currently returns HTTP 405. |
| PATCH | /super_admin/:id | super_admin#update | Placeholder for updating super admin records. Currently returns HTTP 405. |
| DELETE | /super_admin/:id | super_admin#destroy | Placeholder for deleting super admin records. Currently returns HTTP 405. |

## Things (`/things`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /things | things#index | Simple test endpoint that returns "hello"; useful as a connectivity sanity check. |
| GET | /things/new | things#new | Reserved for creating demo records. Currently returns HTTP 405. |
| POST | /things | things#create | Reserved for creating demo records. Currently returns HTTP 405. |
| GET | /things/:id | things#show | Returns a stub JSON object for manual testing and tutorial purposes. |
| GET | /things/:id/edit | things#edit | Placeholder for editing demo records. Currently returns HTTP 405. |
| PUT | /things/:id | things#update | Placeholder for updating demo records. Currently returns HTTP 405. |
| PATCH | /things/:id | things#update | Placeholder for updating demo records. Currently returns HTTP 405. |
| DELETE | /things/:id | things#destroy | Placeholder for deleting demo records. Currently returns HTTP 405. |

## Users (`/users`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /users | users#index | Lists all users ordered by ID; use in admin tooling. |
| GET | /users/new | users#new | Reserved for user creation form rendering. Currently returns HTTP 405. |
| POST | /users | users#create | Creates a user with the supplied email; responds with JSON and 201 on success. |
| GET | /users/:id | users#show | Fetches a user by ID; returns 404 if not found. |
| GET | /users/:id/edit | users#edit | Reserved for HTML editing view. Currently returns HTTP 405. |
| PUT | /users/:id | users#update | Replaces mutable fields such as `email` for a user. |
| PATCH | /users/:id | users#update | Partial update variant for user records. |
| DELETE | /users/:id | users#destroy | Deletes a user record; returns 204 on success. |

## WebAuthn (`/auth/webauthn`)

| Method | Path | Controller#Action | Purpose & Usage |
| --- | --- | --- | --- |
| GET | /auth/webauthn/register/options | webauthn#register_options | Generates WebAuthn registration options for the signed-in user; call before creating a credential. |
| POST | /auth/webauthn/register/verify | webauthn#register_verify | Verifies a WebAuthn registration response and stores the credential. |
| GET | /auth/webauthn/login/options | webauthn#login_options | Returns challenge and allowed credentials for a user to authenticate with passkeys. |
| POST | /auth/webauthn/login/verify | webauthn#login_verify | Verifies a WebAuthn authentication response, signs the user in, and returns redirect info. |
| GET | /auth/webauthn | webauthn#index | Reserved for listing credentials. Currently returns HTTP 405. |
| GET | /auth/webauthn/new | webauthn#new | Reserved for future credential enrollment flow. Currently returns HTTP 405. |
| POST | /auth/webauthn | webauthn#create | Reserved for REST-style credential creation. Currently returns HTTP 405. |
| GET | /auth/webauthn/:id | webauthn#show | Placeholder for fetching a credential by ID. Currently returns HTTP 405. |
| GET | /auth/webauthn/:id/edit | webauthn#edit | Placeholder for editing stored credentials. Currently returns HTTP 405. |
| PUT | /auth/webauthn/:id | webauthn#update | Placeholder for updating stored credentials. Currently returns HTTP 405. |
| PATCH | /auth/webauthn/:id | webauthn#update | Placeholder for updating stored credentials. Currently returns HTTP 405. |
| DELETE | /auth/webauthn/:id | webauthn#destroy | Placeholder for deleting stored credentials. Currently returns HTTP 405. |
