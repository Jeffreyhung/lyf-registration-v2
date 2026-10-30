# Assessment: migrating LYF registration from Firestore to Cloud SQL (PostgreSQL)

_Written 2026-10-26 against commit `93c6c6a` on `main`._

## Verdict

**Not recommended as a full migration right now.** For an app of this size and shape, moving to
Cloud SQL means rewriting the website's entire data-access layer and standing up an always-on API
tier, in exchange for benefits that are real but can mostly be had cheaper by fixing specific
things in place. If SQL is wanted for reporting, add a read-only analytics copy. If SQL is wanted
as the system of record, the lowest-risk path on this stack is Firebase Data Connect piloted on a
bounded slice, not a big-bang swap.

The rest of this document shows the evidence behind that call so it can be revisited when the
facts change.

## 1. What the app is today

| Dimension     | Observed                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scale         | One camp per year, two tracks capped at 85 campers each (`scripts/src/resetCampYearInfo.ts`). Low hundreds of registrations per year, low thousands of documents total across all years.                          |
| Traffic shape | Near zero most of the year, a sharp spike when registration opens, admin dashboard use through spring and camp week.                                                                                              |
| Website       | Gatsby static site on GitHub Pages. **There is no application server.** The browser talks to Firestore and Firebase Auth directly.                                                                                |
| Backend       | Nine Cloud Functions v2: five callables (registration, pre-registration, waitlist, refund, admin roster), two Stripe webhook endpoints, two Firestore triggers.                                                   |
| Authorization | `firestore.rules` (3 roles, field-level `onlyUpdates` guards) plus `assertAdmin` in callables. Covered by 25 emulator rules tests.                                                                                |
| Databases     | Two named Firestore databases (`lyf-v2`, `lyf-v2-test`) sharing one project with v1's `(default)` database.                                                                                                       |
| Integrations  | Stripe Checkout, Slack webhooks, Mailchimp, Gmail OAuth for email, Sentry.                                                                                                                                        |
| Team          | Volunteer-run nonprofit tech. History shows two prior database migrations already (legacy Postgres to Firestore in 2023 via `migration/`, v1 to v2 Firestore in 2026 via `scripts/src/migrateV1ToV2Database.ts`). |

### Firestore features actually in use

Counted across `website/src`, `functions/src`, `scripts/src`:

| Feature                                                               | Uses                  | Where it matters                                                                                                                    |
| --------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Realtime listeners (`onSnapshot`, `useCollection`, `useDocumentData`) | 3 direct + hooks      | Admin dashboards update live when the Stripe webhook flips a registration to Active; parent profile reflects edits without refresh. |
| `where` filters                                                       | 22                    | Family lookup by email (`array-contains`), waitlist ordering, status filters.                                                       |
| `FieldValue.arrayUnion` / `arrayRemove`                               | 15                    | Bidirectional reference arrays: `camper.registrations`, `registration.payments`, `payment.registrations`, `family.emails`.          |
| `FieldValue.increment`                                                | 6                     | Camp credit balance, remaining spots.                                                                                               |
| `serverTimestamp`                                                     | 35                    | Everywhere.                                                                                                                         |
| `writeBatch` / `batch`                                                | 5                     | Small group save, test data creation, familyEmails sync.                                                                            |
| `runTransaction`                                                      | 3                     | Remaining-spots decrement, admin roster changes.                                                                                    |
| `collectionGroup`                                                     | 4                     | Scripts querying campers across families.                                                                                           |
| `getCountFromServer`                                                  | 1                     | Waitlist position.                                                                                                                  |
| Composite indexes                                                     | 5 + 2 field overrides | `firestore.indexes.json`.                                                                                                           |
| TTL policy                                                            | 1                     | `_processedEvents` webhook idempotency.                                                                                             |
| Document-create-as-lock                                               | 1                     | `eventRef.create()` for idempotent Stripe webhook claims.                                                                           |
| Firestore triggers                                                    | 2                     | `syncFamilyEmails` keeps a denormalized field in sync.                                                                              |

### Direct browser writes that security rules currently authorize

These are the places a Cloud SQL design must replace with API endpoints, because a static site
cannot hold database credentials:

- Admin: registration status, internal notes, contacted flag, checkout fields (`RegistrationDashboard`, `Waitlist`, `PendingPayments`, `CamperCheckout`).
- Admin: small group assignment batch save (`SmallGroupSaveButton`).
- Admin: camp credit create/update (`AddCampCredit`), test data create/delete (`CreateTestData`).
- Parents: family address and household fields, camper profile fields, camper health sub-document, shirt size and notes on registrations.
- Everyone: all reads in `useFamilyData`, `useRegistrations`, `usePayments`, `useCampYearInfo`, `useFirebaseAuth`.

## 2. Where Firestore is genuinely hurting this codebase

These are the honest arguments for SQL. Each is visible in the code, not hypothetical.

1. **N+1 fan-out on the admin dashboard.** `useRegistrations` loads every registration, then per
   registration fetches the camper, health doc, demographics doc, family, and parents collection.
   For a full year that is on the order of a thousand reads per dashboard load, mitigated only by
   in-memory maps. In SQL this is one `JOIN` query.
2. **Denormalization with sync machinery.** `familyEmails` is copied onto every registration so
   rules can check ownership without a `get()`, and a Firestore trigger (`syncFamilyEmails`)
   re-fans it out on every family edit. `camperName` is copied onto registrations too. Bidirectional
   reference arrays (`camper.registrations` and `registration.camper`, `payment.registrations` and
   `registration.payments`) have to be kept consistent by hand. Foreign keys make all of this
   disappear.
3. **No enforced schema.** Every type in `schemas/` is `Partial<...>` by necessity, writes stamp
   `schemaVersion`, and `scripts/src` holds 22 ad hoc backfill and repair scripts
   (`addCamperNameToRegistrations`, `addWaitlistTime`, `addFieldsToRegAndCamper`,
   `cleanupLegacyCamperFields`, `migrateToRbac`, `backfillFamilyCreatedBy`, ...). SQL migrations
   plus `NOT NULL` and `CHECK` constraints would replace most of these.
4. **Identity and duplicate problems.** `findOrCreateCamper` matches by first name within a
   family and silently creates a new camper otherwise. `CampCreditTab` has to warn when more than
   one family matches an email. `findOrCreateFamily` throws when a caller is an established member
   of two families. Unique constraints (`UNIQUE (camper_id, camp_year)`, `UNIQUE (email)` on
   confirmed members) would prevent these at write time.
5. **Reporting is client-side.** Demographics charts, filters, and CSV export all run after loading
   the whole year into the browser. Multi-year questions (returning camper rate, pre-registration
   conversion) each need a one-off script. SQL gives ad hoc queries and can feed Looker Studio or
   Metabase directly.
6. **Capacity accounting is split.** `remainingSpots` is read outside any transaction in
   `createRegistrationSession` and decremented in a transaction later; a comment acknowledges
   oversubscription is possible. Note this is a design choice, not a Firestore limitation; a
   Firestore transaction around the read-and-reserve would fix it too. SQL just makes the
   idiomatic fix (`UPDATE ... WHERE remaining > 0 RETURNING`) more obvious.

## 3. What a Cloud SQL migration would actually cost

### 3.1 Architecture change, not a database swap

The website has no server. Every item in the "direct browser writes" list above, and every read
hook, must move behind an API. That API must re-implement the three-role RBAC with field-level
update restrictions that `firestore.rules` enforces today, and the 25 rules tests become API
authorization tests. This is the dominant cost and it is a rewrite of the website's data layer
plus a new deployable, not a port.

Options for that API tier:

| Option                                                                                                          | Fit                         | Notes                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run service (Node, Postgres driver, Firebase Auth token verification)                                     | Good                        | Scale-to-zero compute, but needs the Cloud SQL connector, connection pooling, cold starts during the registration spike. New deploy pipeline.                             |
| More Cloud Functions, one per read/write                                                                        | Poor                        | Dozens of functions; connection management per instance is awkward; the current nine functions already carry an `isolate` build step.                                     |
| Firebase Data Connect (GraphQL over Cloud SQL Postgres, Firebase Auth `@auth` directives, generated typed SDKs) | Best fit if SQL is the goal | Keeps the "no server" model the site depends on. GA since April 2025. Adds a GraphQL schema layer the team must learn. Realtime is not equivalent to Firestore listeners. |

### 3.2 Realtime

Firestore listeners drive the admin dashboards and parent profile. Postgres has no equivalent out
of the box. Choices are polling or refetch-on-action (probably acceptable for this app), Postgres
`LISTEN/NOTIFY` bridged over websockets (new infrastructure), or a hosted layer such as Supabase
Realtime (new vendor). This is a feature regression to plan for, not a blocker.

### 3.3 Cost floor and operations

Firestore today is serverless and almost certainly inside or near the free tier for this volume.
Cloud SQL has no scale-to-zero and no free tier beyond a trial.

| Item                                | Firestore (Standard)                                                                                                                                            | Cloud SQL for PostgreSQL                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Free allowance                      | 50k reads, 20k writes, 20k deletes per day, 1 GiB storage. Applies to one database per project, so check whether the named `lyf-v2` databases are billed today. | 3-month trial on default config via Data Connect only.                                                                                          |
| Smallest instance                   | n/a                                                                                                                                                             | `db-f1-micro` (shared core, no SLA): roughly $8–10/month compute, storage and backups extra.                                                    |
| Realistic small production instance | n/a                                                                                                                                                             | Dedicated 1 vCPU: roughly $30–60/month plus storage; HA about doubles it.                                                                       |
| Idle cost                           | $0                                                                                                                                                              | Full instance price year-round for a one-month spike.                                                                                           |
| Maintenance                         | None                                                                                                                                                            | Maintenance windows, version upgrades, backup/PITR configuration, connection limits, connector or Auth Proxy setup for Cloud Run and Functions. |

Pricing figures are from third-party trackers and Google docs as of this writing; verify on
the Google Cloud pricing pages before budgeting.

### 3.4 Everything else that moves

- **Local development.** Firebase emulators are replaced by Docker Postgres, a migration tool, and seed scripts. Manageable.
- **Two environments.** `lyf-v2` and `lyf-v2-test` become two databases or schemas. Trivial in Postgres.
- **Webhook idempotency.** `_processedEvents` with TTL becomes a table with `INSERT ... ON CONFLICT DO NOTHING` and a cleanup job. Simpler, if anything.
- **Stripe metadata.** Line items carry Firestore document paths (`registrationRef`, `familyRef`); these become integer or UUID ids. Straightforward, but in-flight checkout sessions at cutover must still resolve.
- **Firestore triggers.** `syncFamilyEmails` is deleted; foreign keys make it unnecessary.
- **Data migration.** Third ETL in three years, this time across data models (document refs to foreign keys, reference arrays to join tables, `private/` sub-documents to column-level permissions). Must land in the off-season window between camp (July) and pre-registration opening (January), with a dual-read or shadow period.
- **Shared package.** `lyf-registration-schemas` is typed on `firebase/firestore` `DocumentReference` and `Timestamp`; it would be rewritten around plain ids and ISO dates.

### 3.5 Rough effort

Ranges assume one engineer familiar with the codebase. They are estimates for sizing the
decision, not a plan.

| Work                                                                                                                             | Range                            |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Relational schema, migrations, seed data                                                                                         | 1–2 weeks                        |
| API tier with RBAC and tests (Cloud Run) or Data Connect schema with `@auth`                                                     | 3–5 weeks                        |
| Website: replace hooks and all direct Firestore calls in Admin, Profile, Registration, CamperCheckoutFlow, SmallGroup components | 3–5 weeks                        |
| Cloud Functions rewrite (registration, fulfillment, waitlist, refund, admin roster)                                              | 1–2 weeks                        |
| ETL, shadow period, cutover, rollback plan                                                                                       | 2–3 weeks                        |
| Dev environment, CI, deploy pipeline                                                                                             | 1–2 weeks                        |
| **Total**                                                                                                                        | **roughly 11–19 engineer-weeks** |

For a volunteer team working part-time that is most of a year, and it has to land in a fixed
off-season window.

## 4. Cheaper ways to get most of the benefit

Each of these addresses a specific pain point from section 2 without changing the database.

1. **Collapse the dashboard fan-out.** Denormalize the few camper and family fields the admin grid
   needs (name, grade, parent emails, phone) onto the registration at write time, the same way
   `camperName` and `familyEmails` already are. One listener, no per-row `getDoc`. Health and
   demographics stay in `private/` and load lazily on row expand.
2. **Fix capacity accounting with a transaction.** Read `remainingSpots` and reserve inside the
   same `runTransaction` in `createOrUpdateRegistration`. Removes the acknowledged race without
   any infra change.
3. **Enforce the schema at the boundary.** Add a runtime validator (zod or similar) in the
   `schemas` package and use it in every function write and in CI against the emulator. Replaces
   the "everything is Partial" posture for new writes without a migration.
4. **Add uniqueness where it matters.** Make registration document ids deterministic
   (`${camperId}_${campYear}`) so a second registration for the same camper and year is impossible
   by construction. Match campers on a normalized `(firstName, lastName, birthDate)` key rather
   than first name alone.
5. **SQL for reporting only.** Install the Firestore-to-BigQuery export extension, or run a nightly
   scheduled export into BigQuery or a tiny Postgres. Admins and scripts get real SQL and Looker
   Studio over read-only data; the system of record stays serverless. This directly answers the
   "we want SQL" ask at a fraction of the cost and with zero cutover risk.
6. **Retire the script pile.** Turn the recurring `get*` reports in `scripts/src` into queries over
   the reporting copy from item 5, and delete the one-off backfills that have already run.

## 5. When this decision should be revisited

A full move to Cloud SQL becomes the right call if several of these become true:

- The system becomes multi-tenant (other camps or organizations) and cross-entity reporting is a daily need rather than a seasonal one.
- A paid or stable engineering team is comfortable owning an API server and a database, and the volunteer bus-factor concern no longer applies.
- Firestore read costs materially exceed a small Cloud SQL instance (they are nowhere near that today).
- Financial record-keeping (payments, credits, refunds) needs ledger-grade integrity with constraints and audited migrations.
- The team wants to adopt Data Connect anyway and is willing to pilot it on a bounded slice (payments and credits are the most relational and least realtime-sensitive) before touching families and registrations.

## 6. Recommendation

1. Stay on Firestore as the system of record for the next registration cycle.
2. Do items 1, 2, and 4 from section 4 before pre-registration opens; they fix the most visible
   correctness and performance problems at low risk.
3. Set up the BigQuery (or small Postgres) reporting export so admins get SQL this cycle.
4. If appetite for SQL as system of record persists after that, prototype Firebase Data Connect
   on payments and credits in the next off-season and decide from that evidence.

## Sources

- [Firestore pricing](https://cloud.google.com/firestore/pricing) and [Firestore Enterprise pricing](https://firebase.google.com/docs/firestore/enterprise/pricing)
- [Cloud SQL db-f1-micro indicative pricing (Bytebase tracker)](https://www.bytebase.com/dbcost/cloudsql/instance/db-f1-micro/) and [Cloud SQL pricing overview (usage.ai)](https://www.usage.ai/blogs/gcp/cloud-sql/pricing/)
- [Firebase Data Connect general availability](https://firebase.blog/posts/2025/04/dataconnect-general-availability) and [Data Connect pricing](https://firebase.google.com/docs/data-connect/pricing)
