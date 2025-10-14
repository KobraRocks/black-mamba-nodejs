# Booking System Specification for Black Mamba

## Overview

This document outlines the specification for a **Calendly-like booking
system** to be implemented as an internal library for the Black Mamba
NodeJS framework. The system will enable users (referred to as
**Bookers**) to set up meeting event types and allow external guests to
schedule appointments. Key features include robust **time zone
handling**, flexible **availability rules** with buffer times, support
for both **one-on-one and group meetings**, role-based access (Admin,
Booker, Guest), email **notifications** (using Black Mamba's internal
SMTP library), and **magic link** functionality for guest access. The
implementation must use **SQLite** for data storage and rely only on
**internal libraries**, adhering to Black Mamba's Rails-like API
conventions.

## User Roles and Permissions

- **Admin:** Has full control over the booking system. Admins can
    create and manage Booker accounts, configure global settings, and
    view or edit all bookings.
- **Booker:** A user who can be "booked" for meetings. Bookers (e.g. a
    consultant or team member) can create event types (meeting offerings
    like "30-min call"), define their availability schedule, and manage
    their own bookings. They have a public booking page/ID to share with
    guests.
- **Guest:** An external user who wants to schedule a meeting with a
    Booker. Guests do not need an account. They can view available slots
    for a Booker's event via a public link, then book a slot by
    providing minimal info (name, email). Guests can later view or
    cancel their bookings via magic link without logging in.

## Meeting Event Types (One-on-One vs Group)

Each Booker can set up **Event Types** that define the kind of meetings
guests can book. When creating an event type, the Booker decides whether
it is one-on-one or a group meeting:

- **One-on-One Event:** Allows only one guest per time slot. Once a
    slot is booked, it becomes unavailable to others (no
    double-booking).
- **Group Event:** Allows multiple guests to book the **same time
    slot** (up to a defined capacity). The meeting owner (Booker) sets
    the maximum number of guests who can join. The slot remains open for
    booking until the capacity is reached.

Event types have configurable settings, including:\

- **Duration:** e.g. 15 minutes, 30 minutes, 1 hour, etc.\
- **Slug/Name:** a URL-friendly identifier (e.g. "30-min-call") used in
public booking links.\
- **Location/Method:** optional info like "Zoom call", "Phone call",
etc., included in notifications (could be static text or template).\
- **Meeting Type:** one-on-one or group (with capacity if group).\
- **Buffer Time:** optional padding time **before and/or after** the
event (more details below).\
- **Advance Notice:** minimum notice required before a meeting can be
booked (e.g. at least 2 hours in advance).\
- **Booking Window:** how far into the future the event can be booked
(e.g. allow bookings up to 60 days from now).

## Time Zone Handling

Time zone management is critical so that both Bookers and Guests can
interact in their local times:\

- **Booker's Time Zone:** Each Booker will have a default time zone
setting (configurable in their profile). All availability schedules are
defined in the Booker's local time zone. The system stores these in a
normalized format (e.g. UTC internally) to avoid DST issues.\
- **Guest's Time Zone:** When a Guest opens a booking page, available
slots should be shown adjusted to the Guest's local time zone. The
system can detect the Guest's zone from the browser or ask the guest to
select their time zone. This ensures the guest knows exactly when the
meeting will occur in their own time.\
- **Storage in UTC:** All date/times for availability and bookings are
stored in the database in UTC for consistency. Conversions are done at
the display layer (to Booker's or Guest's zone as needed). This approach
handles daylight savings and cross-timezone scheduling reliably.\
- **Time Zone Conversions:** Use JavaScript's built-in `Intl` APIs or
internal time utilities for conversion -- no external dependencies like
Moment.js. This means carefully handling offsets and DST. For example,
if a Booker in \"America/New_York\" offers a 9 AM slot, a guest in
\"Europe/Paris\" should see it as 3 PM (CET) during standard time.

## Availability Rules and Buffer Times

Bookers can define their general availability and specific rules per
event type:

- **Weekly Availability:** Booker sets recurring available hours (e.g.
    Mon-Fri 9:00--17:00, Sat 10:00--14:00). These create the baseline
    schedule for open slots.
- **Date-Specific Overrides:** Booker can mark exceptions (vacation
    days, special off-days) or additional availability on certain dates.
    The system should allow blocking out specific dates/times or
    extending hours for a particular day.
- **Buffer Times:** To prevent back-to-back meetings, Bookers can
    configure a buffer period that will be **automatically added before
    and/or after each booking**. For example, a 30-min meeting might
    have a 10-minute buffer after it -- if a meeting ends at 10:30, the
    next slot shouldn't start until 10:40. Buffer rules ensure the
    Booker has preparation/travel time between meetings. This is defined
    per event type (some event types might require longer prep time).
    The scheduling algorithm will **exclude slots that violate buffer
    requirements**.
- **Preventing Conflicts:** The system will **not allow overlapping
    bookings** for one-on-one events. For group events, overlapping is
    allowed only up to the capacity. The availability lookup will
    consider existing confirmed bookings: once a slot is fully booked
    (or taken for one-on-one), that slot is removed from the Guest's
    view of open times.
- **Lead Time & Cut-off:** Incorporate an **advance notice** rule --
    e.g. if set to 1 day, a guest cannot book a meeting less than 24
    hours away. Also support a **cut-off time** (latest allowable
    booking time in the future, e.g. cannot book more than 90 days out).
    These rules prevent last-minute or very far-future bookings as per
    Booker's preference.
- **Time Slot Generation:** Given the above inputs (availability
    schedule, duration, buffers, existing bookings, lead time), the
    system generates a list of open slots for each event type. Slots
    should align with event duration increments. For example, if
    availability starts at 9:00 with 30-min duration, slots would be
    9:00--9:30, 9:30--10:00, etc., skipping or shortening around buffer
    gaps and end-of-day.

## Booking Workflow

The booking process is designed to be simple for the Guest while
ensuring data integrity and notifications on the backend:

1. **Access via Public Link:** The Booker shares a scheduling link with
    the Guest. The link format will be:

- /booking/{booker-public-id}/{event-slug}

    For example: `/booking/abc123/30-min-call` -- where `abc123` is the
    Booker's public ID and `30-min-call` identifies the event type. This
    URL is used to load the booking page showing that specific Booker\'s
    30-min call slots. *(This structure follows Black Mamba's Rails-like
    routing style, mapping to an internal controller action for
    bookings.)*【**(See Black Mamba documentation for routing
    conventions)**】

2. **Viewing Availability:** The system displays an interactive
    calendar or list of available time slots for the chosen event type.
    The Guest can navigate dates (limited by the Booker\'s defined
    schedule and booking window). All times are shown in the Guest's
    local time zone for clarity.

3. **Selecting a Slot:** The Guest picks a suitable date and time from
    the available options. The frontend or client then calls the booking
    API to **create a new booking**. The API endpoint for creating a
    booking could be a POST to a URL such as:

- POST /bookers/{bookerId}/events/{eventTypeId}/bookings

    (Following a Rails-like nested resource pattern, where the booking
    is a sub-resource of a specific event type. Alternatively, a flat
    `POST /bookings` with references to booker and event type in the
    payload could be used. The internal implementation will route
    appropriately based on Black Mamba conventions.)

4. **Booking Data Collection:** The Guest fills in their **name,
    email**, and possibly additional fields (the system can allow the
    Booker to define custom questions, but MVP can start with
    name/email). The request includes this info along with the selected
    date/time.

5. **Conflict Check and Confirmation:** The backend receives the
    booking request and will:

6. Verify the slot is still available (not booked by someone else in
    the interim, and within availability & buffer constraints).

7. If one-on-one, ensure no existing booking overlaps that slot. If
    group, check the slot's current attendee count and capacity.

8. Create a **Booking** record in the SQLite database with status
    "Confirmed" (or possibly "Pending" if needing manual approval, but
    by default auto-confirmed). Fields include: Booker ID, Event Type
    ID, Guest name, Guest email, start datetime, end datetime, and
    possibly a unique booking reference or public token for
    cancellation.

9. Reduce availability for that slot (mark it as taken so it won't
    appear to others).

10. **Response to Guest:** The API returns a confirmation of booking
    (meeting details, perhaps a booking ID or reference). The frontend
    can then show a "Booking Confirmed" message or page to the Guest,
    including details (date/time in Guest timezone, and a note that a
    confirmation email has been sent).

11. **Calendar Invitation:** As part of confirmation, the system
    triggers sending calendar invites (see Notifications below) so that
    both parties can add the event to their calendars easily.

12. **Prevent Double Booking Race:** Use a **transaction or locking
    mechanism** (supported by SQLite) when creating a booking to avoid
    race conditions. If two guests try to book the same slot nearly
    simultaneously, the second should fail gracefully with a message
    that the time was just booked.

13. **Cancellation/Rescheduling (Optional for later):** The system
    should allow cancellations or rescheduling. While not explicitly
    requested, designing the model with a status field (Confirmed,
    Canceled) and adding an endpoint or link for cancelation will be
    valuable. If a booking is canceled, the slot becomes available again
    (for one-on-one) or frees one spot (for group). Cancellation
    notifications would be sent out as well. This can be facilitated
    through magic links (detailed below).

## Email Notifications (SMTP & ICS Integration)

Email notifications are an essential part of the system, handled via
Black Mamba's internal SMTP library (no external email packages). All
emails should be sent promptly upon booking confirmation (and other
triggers) with relevant details:

- **Confirmation Email:** When a booking is made, send a confirmation
    email to both the Guest and the Booker. This email includes:

- Meeting details: date and time (with time zone) and duration.

- Guest's name and email (for Booker's copy) and Booker's name and
    contact info (for Guest's copy).

- Location or meeting link (if the event has a static conference link
    or address).

- **ICS Calendar Invite:** Attached `.ics` file so the recipient can
    add the event to their calendar with one click. The ICS should
    contain event start/end in UTC (with proper time zone info for
    compatibility), the subject (e.g. "Meeting with \[Booker Name\]"),
    description (could include any notes or a Zoom link, etc.), and
    organizer/attendee email info. This ensures that in email clients
    (e.g. Outlook, Gmail), it shows up as a meeting
    invite[\[1\]](https://github.com/denosaurs/deps.index/blob/8b15f5c2e6b60b1d6e9b870a71c084b7dd1d407c/x/sm/tp/smtp_connection#L1-L4).

- The email content should be simple and clear (possibly using a
    template from the SMTP lib if available), and **both HTML and text
    versions** for compatibility.

- **Reminder Email:** The system will send automatic reminders before
    the meeting. The reminder timing could be configurable (e.g. 1 hour
    before or 1 day before). Reminders again list the meeting details
    (time, a polite note "looking forward to our meeting soon"). No ICS
    attachment is needed for reminders (since the event is already in
    their calendar), but including the event summary and maybe a link to
    cancel/reschedule (magic link) is useful.

- **Follow-up Email:** After the meeting time has passed, an optional
    follow-up can be sent (e.g. "Thank you for meeting" or a feedback
    request). This can be configured per event type (some Bookers may
    enable or disable automatic follow-ups).

- **Cancellation Email:** (if cancellations are allowed) If a booking
    is canceled by either party, send notifications to the other party
    indicating the meeting will not take place. Include a link if needed
    to reschedule a new meeting.

All emails are sent through the **internal SMTP lib** -- which means
using Black Mamba's provided SMTP client (`libs/smtp`). For example, the
system will use something like:

    // Pseudocode for sending email via internal SMTP lib
    const smtp = require('blackmamba/libs/smtp');
    smtp.send({
      to: guestEmail,
      subject: "Meeting Confirmation",
      html: renderedHtmlContent,
      text: plainTextContent,
      attachments: [{ filename: "invite.ics", content: icsFileContent, contentType: "text/calendar" }]
    });

This avoids any external dependencies (like Nodemailer) by leveraging
the Black Mamba SMTP module. The ICS content can be generated manually
by formatting a string in iCalendar format (BEGIN:VCALENDAR\... etc.)
with the event details, or via any helper provided internally. The
**internal SMTP README** provides guidance on attachments and formatting
(e.g. ensuring the email headers indicate an ICS meeting invite,
typically `text/calendar` MIME with `method=REQUEST`). The outcome is
that when the guest and booker receive the email, their mail client will
show an "Add to Calendar"
option[\[1\]](https://github.com/denosaurs/deps.index/blob/8b15f5c2e6b60b1d6e9b870a71c084b7dd1d407c/x/sm/tp/smtp_connection#L1-L4)
(since the ICS is recognized as a meeting invite). *(The SMTP library
likely handles low-level SMTP connection/auth -- ensure to configure
SMTP server credentials in Black Mamba's config.)*

## Magic Link for Guest Access

To enhance user experience for Guests (who don't have accounts), the
system will implement a **magic link** mechanism for accessing bookings:

- **Purpose:** Allow a Guest to view or manage their bookings without
    needing a password or formal account. After booking, or at any time,
    a guest can retrieve a list of their upcoming meetings by just
    providing their email and clicking a secure link.
- **Flow:** A "Manage your bookings" link is provided in confirmation
    emails. Additionally, the public interface can have a page where a
    guest enters their email address to request a magic link.
- **Email Verification:** When a Guest enters their email, the system
    sends an email to that address with a special **magic link URL**.
    For example:

<!-- -->

- /guest/bookings?token={tokenValue}

    The token is a unique, single-use (or short-lived) secure token that
    maps to that guest's identity (possibly a signed JWT or a random
    UUID stored server-side).

<!-- -->

- **Access via Token:** When the guest clicks the link, they are
    logged in as a "Guest" in context and taken to a page listing all
    bookings associated with their email. This page is protected by the
    token (so only someone with access to that email can get in). No
    password needed.
- **Functionality on Magic Link Pages:** The guest can see details of
    each upcoming booking (date/time, Booker name, event type). We
    should allow the guest to **cancel** a booking here if needed (and
    possibly request reschedule, though rescheduling can simply be
    cancel + new booking). If cancellation is done, the system will mark
    the booking canceled and send out cancellation emails as noted. The
    magic link might also allow adding another booking quickly by
    linking back to the Booker's scheduling page.
- **Token Security:** Tokens should be time-limited (for example,
    valid for 15 minutes from request) if single-use, or if persistent
    tokens are used (e.g. stored with the booking record), ensure they
    are sufficiently random (high entropy) to not be guessable. Given
    this is an internal library, we can use Node's `crypto` module to
    generate secure random tokens or use a built-in Black Mamba utility
    if provided.

## API Endpoints and Routing

The booking system will expose a set of HTTP API endpoints (and possibly
server-rendered pages where appropriate) that conform to Black Mamba's
Rails-like routing style. This means using **RESTful resource naming**
and nesting where logical. All endpoints will be implemented in Black
Mamba's routing system (likely defined in a routes file or via
annotations, as per the framework's convention). Key endpoints include:

- **Public Booking Page:**

- `GET /booking/:bookerPublicId/:eventSlug` -- Serves the booking
    interface for a given Booker and Event Type. This likely calls a
    `BookingsController.show` or similar internally. It will load the
    Booker's profile (via `bookerPublicId`) and event type by slug, then
    either render an HTML page (if Black Mamba supports server-side
    rendering) or provide the data for the frontend to render (available
    slots, event info). This endpoint does not require authentication
    (open to anyone with the link).

- **Retrieve Available Slots (API):**

- `GET /bookers/:bookerId/events/:eventId/slots` -- Returns
    available time slots for that event type, possibly in JSON. This
    would be called via XHR by a frontend after the booking page loads
    (if not already embedded in server render). Slots will be calculated
    on the fly based on current time, availability, and existing
    bookings. (If Black Mamba's architecture allows, this could also be
    handled in the same controller as above, depending on SSR vs API
    design choices.)

- **Create Booking (API):**

- `POST /bookers/:bookerId/events/:eventId/bookings` -- Creates a
    new booking for the specified event type. Expects JSON payload like
    `{ guestName, guestEmail, startTime, [optional other fields] }`. On
    success, returns booking details or confirmation. Under the hood,
    this maps to something like `BookingsController.create`, where it
    will perform the steps to save the booking and trigger emails. The
    URL structure shows nested resources (a booking belongs to a
    specific booker's event type). We could also allow a shorthand
    `POST /booking/:bookerPublicId/:eventSlug` (to mirror the GET link)
    for convenience, which internally translates to the same create
    action -- this fits the user-friendly URL style.

- **View Guest's Bookings (Magic link page):**

- `GET /guest/bookings?token=XYZ` -- This endpoint shows the logged-in
    view for a Guest using a magic token. It will verify the token and
    then list bookings. Internally could map to
    `GuestBookingsController.index`. If the token is invalid or expired,
    return an error or redirect to request a new link.

- `POST /guest/bookings/:id/cancel?token=XYZ` -- Endpoint for a guest
    to cancel a specific booking. (Could also be done via a
    `DELETE /guest/bookings/:id?token=...` to be more RESTful). This
    will mark the booking canceled if token authorized, and trigger
    notifications.

- **Booker Management (Admin/Booker APIs):**

- `POST /bookers` -- Admin endpoint to create a new Booker account (or
    Bookers sign-up flow).

- `GET /bookers/:id/events` -- List event types for a Booker (Booker
    can call their own, Admin can call any).

- `POST /bookers/:id/events` -- Create a new event type (Booker
    defines meeting settings like duration, buffers, etc.).

- `PUT/PATCH /bookers/:id/events/:eventId` -- Update an event type's
    settings (e.g. change availability or meeting name).

- `DELETE /bookers/:id/events/:eventId` -- Remove an event type (or
    deactivate it).

- `GET /bookers/:id/bookings` -- Booker's view of their bookings
    (could filter by event type or show all upcoming). Bookers would
    need to authenticate (maybe Black Mamba has an auth system) -- not
    covered here, but assume sessions or tokens for Booker/Admin login.

- **Admin APIs:**

- `GET /bookings` -- Admin can list all bookings in the system
    (perhaps with query params for filtering by booker or date).

- `DELETE /bookings/:id` -- Admin can force cancel a booking.

- `GET /bookers` -- list all bookers (for management).

- (Other user management endpoints as needed for admin -- beyond core
    scheduling scope.)

**Routing Conventions:** Black Mamba's Rails-like style means these
endpoints likely map to controller actions in a predictable way, e.g., a
`BookingsController` with methods like `show` (for public booking page),
`create` (for new booking), `index` (for admin list), etc., and maybe
separate controllers for `BookersController` (managing booker accounts
and their event types) and `EventsController` (or nested under bookers).
We will adhere to plural nouns and nested routes to clearly delineate
relationships (booker -\> events -\> bookings). The example given
`/booking/:booker-public-id/30-min-call` is a bit of a hybrid (not
pluralized "bookings") likely to make a friendly URL; internally, we'll
treat it accordingly (e.g. route pattern might be defined explicitly for
that public page).

All API endpoints will use standard HTTP response codes and JSON data
for success or errors (e.g. 201 Created for booking made, 400 for
validation errors like slot taken, etc.). Error messages should be
descriptive (and possibly localized) so the UI can show appropriate
feedback (e.g. "This time slot is no longer available, please choose
another.").

## Data Model (SQLite Database)

The system will use **SQLite** as the database. We will design a simple
schema with tables to support the above features. The primary
tables/entities are:

- **Bookers** (the users who can be booked):

- `id` (PK) -- internal ID.

- `public_id` -- a unique public identifier (e.g. UUID or hash) used
    in URLs instead of sequential ID for security (`abc123` in
    examples).

- `name` -- Booker's name.

- `email` -- Booker's email (for notifications, and possibly login).

- `timezone` -- default time zone (e.g. \"America/New_York\").

- `availability_rules` -- rules for availability (this could be a
    separate table, but can be stored as JSON or a structured text since
    SQLite supports JSON). For example, store regular weekly schedule
    and any specific exclusions/inclusions. Alternatively, have a
    **BookerAvailability** table keyed by booker, day-of-week and time
    ranges, plus an **UnavailableDates** table for exceptions. In this
    spec, a simple JSON schedule in the Bookers table might suffice for
    MVP.

- `created_at, updated_at` timestamps.

- (Possibly an `is_admin` flag if using the same table for admin
    accounts, or separate Admins table. But since roles are distinct, an
    Admin could just be a Booker with elevated rights or handled
    separately in application logic.)

- **EventTypes** (meeting templates that bookers offer):

- `id` (PK).

- `booker_id` (FK to Bookers). Each event type is owned by a Booker.

- `name` -- human-friendly name (e.g. \"30 Minute Consultation\").

- `slug` -- URL slug (e.g. \"30-min-call\"). Unique per booker (booker
    can't have two event types with same slug).

- `duration` -- length of the meeting in minutes.

- `buffer_before` -- buffer time required before this event (minutes,
    default 0).

- `buffer_after` -- buffer time after the event (minutes).

- `is_group` -- boolean, true if group event.

- `capacity` -- if group event, how many guests can attend (if
    `is_group` is false, capacity is implicitly 1).

- `advance_notice` -- minimum minutes or hours before now that this
    can be booked.

- `booking_window` -- maximum days out the event can be booked (e.g.
    90). Could also be a date until which booking is allowed.

- `location` -- optional location or meeting link info (text or URL).

- `description` -- optional longer description or instructions for the
    event (shown on booking page or in invite).

- `active` -- boolean to disable an event type without deleting.

- `created_at, updated_at`.

- **Bookings** (each scheduled appointment instance):

- `id` (PK).

- `booker_id` (FK to Bookers for convenience, also reachable through
    event type).

- `event_type_id` (FK to EventTypes).

- `guest_name`.

- `guest_email`.

- `start_time` -- DateTime (in UTC).

- `end_time` -- DateTime (in UTC). This can be derived from
    start_time + duration, but storing explicitly can simplify queries.

- `guest_timezone` -- the time zone of the guest (if captured or
    inferred). This could be stored to reference what time zone the
    guest viewed when booking, useful for sending localized times in
    emails.

- `status` -- e.g. "confirmed" (default), "canceled".

- `created_at, updated_at`.

- `cancel_token` -- a unique token for cancellation/magic link per
    booking (could be separate from the general magic link, or
    combined). Alternatively, we might not store a token per booking if
    using a general magic link approach tied to email. But for security,
    a per-booking token can be used to authenticate cancellation
    requests (to ensure the email owner is canceling their own meeting).

- **Admins:** if needed, a separate table or just use Bookers with a
    role field. Likely simplest is to have a boolean on Bookers for
    admin rights, since they have similar structure (name, email, etc.).

- **Others:** If storing availability separately: e.g.
    **BookerAvailability** (fields: booker_id, day_of_week, start_time,
    end_time) and **BookerTimeOff** (booker_id, date, reason). These can
    feed the slot generation algorithm. However, these could also be
    managed in config files or JSON in Bookers table for simplicity,
    given no external libs needed (less complexity).

All data will be stored in SQLite (likely a file database). Black Mamba
may have an internal ORM or we use parameterized SQL queries via the
Node SQLite3 driver (assuming it\'s allowed internally or maybe an
internal lib wraps it). Transactions will be used when creating or
canceling bookings to maintain consistency (especially important for
decrementing capacity on group events or avoiding race conditions).

**Database Access:** Since external ORM libraries are not allowed, if
Black Mamba does not provide an ORM, we can use the Node.js `sqlite3`
module or a lightweight query builder that's already part of the
framework. The queries will handle converting time zones (likely by
always dealing in UTC in the DB and converting in/out in application
logic).

**Example:** When searching for open slots for a given date, we might
perform a query like: select all bookings for that booker on that date,
then compare against availability windows to filter out taken times.
Complex logic (like generating timeslots and filtering by buffer) will
likely happen in application code rather than a single SQL query, for
clarity.

## Internal Libraries Utilization

This booking system will be built entirely with Black Mamba's internal
tools and no external dependencies:

- **SMTP Library:** As described, all email sending uses the internal
    `libs/smtp` module. The spec ensures to format emails (especially
    the ICS attachment) according to standards so Outlook/Gmail
    recognize them as
    invites[\[1\]](https://github.com/denosaurs/deps.index/blob/8b15f5c2e6b60b1d6e9b870a71c084b7dd1d407c/x/sm/tp/smtp_connection#L1-L4).
    We rely on `libs/smtp` for low-level SMTP connection and sending.
    Any configuration (SMTP server host, port, auth) can be loaded from
    Black Mamba config files.

- **Routing/Controllers:** We will create controllers (e.g.
    `BookingsController`, `BookersController`, etc.) within the Black
    Mamba project structure. Black Mamba's Rails-like routing means we
    might define routes in a `routes.js` or via decorators, ensuring our
    endpoints (as listed in the API section) are registered. The
    framework likely provides a way to map URL patterns to controller
    actions similarly to Rails routes【**(source: Black Mamba
    README)**】. We will follow naming conventions (controllers in
    plural form, methods for CRUD operations). The controllers will use
    the framework's request/response objects to handle data (possibly
    similar to Express under the hood).

- **Magic Link Implementation:** For generating secure tokens, we can
    use Node's built-in `crypto.randomBytes` to create a random token
    string, and Node's `crypto` or `jsonwebtoken` if available
    internally for any signing. Since external packages are disallowed,
    if a JWT library isn't internal, we stick to random tokens stored in
    DB. The token emailing and verification logic will be part of the
    Guest access controller.

- **Date/Time Utilities:** If Black Mamba includes any date utility
    library internally, we should use it. Otherwise, use the JS `Date`
    object, `Intl.DateTimeFormat`, and possibly maintain our own simple
    timezone offset map for converting availability times (or use the
    `toLocaleString` with time zone). We must be careful with DST
    transitions. We might consider storing availability in a normalized
    way and doing conversion math ourselves if needed (e.g., storing
    availability in minutes from midnight, etc.).

- **No External Dependencies:** We will not use moment.js, luxon,
    fullcalendar, etc. The front-end calendar interface could use basic
    HTML/JS or a minimal approach (since not specified, the UI can be
    simplified). If Black Mamba has any front-end support or templating,
    we utilize that (e.g. EJS/Pug templates or a built-in UI component).
    If not, it may be expected that an external front-end will consume
    the API. In any case, the back-end will be fully functional via
    internal means only.

- **Testing:** As part of development, ensure to write unit tests (if
    framework supports) for key functions like slot generation (with
    various time zones, buffer scenarios), booking creation (especially
    edge cases of double booking), and email sending (perhaps using a
    dev SMTP sink). No external test frameworks unless Black Mamba
    includes one.

## Conclusion

This specification covers a comprehensive scheduling/booking system akin
to Calendly, tailored for the Black Mamba NodeJS framework. By following
the above design -- handling time zones correctly, enforcing
availability and buffer rules, supporting both one-on-one and group
meetings, and integrating email notifications with calendar invites --
the implementation will provide a smooth experience for Bookers and
their Guests. All functionality will be achieved with Black Mamba's
internal libraries (SMTP for email, built-in routing, etc.) and SQLite
for persistence, ensuring no external dependencies and aligning with the
framework's Rails-like architecture. The end result will be a flexible,
self-contained booking library ready to integrate into any Black Mamba
project, enabling easy scheduling of meetings and automation of
notifications.

------------------------------------------------------------------------

[\[1\]](https://github.com/denosaurs/deps.index/blob/8b15f5c2e6b60b1d6e9b870a71c084b7dd1d407c/x/sm/tp/smtp_connection#L1-L4)
smtp_connection

<https://github.com/denosaurs/deps.index/blob/8b15f5c2e6b60b1d6e9b870a71c084b7dd1d407c/x/sm/tp/smtp_connection>
