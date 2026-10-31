# scripts: Firebase Admin SDK maintenance scripts

One-off and bootstrap operations that need the Admin SDK (which bypasses the
security rules). Everything a program director needs day to day is in the
admin dashboard instead; a script is the fallback for the chicken-and-egg
cases (the very first admin, a brand-new test database) and for data
backfills that ship with a schema change.

Data **exports** are not scripts any more: use the admin dashboard's All
Registrations grid → Export ([docs/admin-runbook.md](../docs/admin-runbook.md#exports)).

## Running a script

Authentication is your own Google account through gcloud Application Default
Credentials. There is no service-account key file, and none should be created:
anyone in the `lyf.technology@tacl.org` group already has the needed roles on
the `lyf-registration` project.

```bash
gcloud auth application-default login     # once per machine
cd scripts
yarn run build                            # tsc → lib/
GOOGLE_CLOUD_PROJECT=lyf-registration node lib/<script>.js
```

`./run.sh -n <script>` does the build + run for you and sets
`GOOGLE_CLOUD_PROJECT`. Environment variables go in front of it:

```bash
ADMIN_EMAIL=someone@tacl.org ./run.sh -n grantAdminAccess
APPLY=1 FIRESTORE_DATABASE_ID=lyf-v2-test ./run.sh -n backfillFamilyCreatedBy
```

Rules every script follows:

- **Dry run by default.** Scripts that write take `APPLY=1` (some also accept
  `--apply`); without it they only report what they would change.
- **Named databases.** v2 data lives in `lyf-v2` (production) and `lyf-v2-test`;
  `(default)` and `internal-test` belong to v1. Each script reads its target
  from an environment variable with a safe default, listed below. A backfill
  that changes the document shape has to run against **both** v2 databases.
- `output/` (git-ignored) is where scripts drop report files.
- The schemas package must be built first (`yarn build:packages` at the root);
  the scripts import `lyf-registration-schemas` from its `dist/`.

## Scripts

| Script                                      | Use it when                                                                                                                                                                                                 | Environment                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grantAdminAccess.ts`                       | Creating the very first `full_admin`, or recovering from a lockout. Normal roster changes go through the dashboard's Admin Management tab (`manageAdmin`, with audit log and last-admin guard).             | `ADMIN_EMAIL` (required), `ADMIN_ROLE` (`full_admin`, `program_admin`, `program_staff`, `health_staff`; default `full_admin`), `FIRESTORE_DATABASE_ID` (default `lyf-v2`) |
| `resetCampYearInfo.ts`                      | Seeding or overwriting `camps/{year}` in the **test** database from a JSON file, e.g. for a brand-new test database. The dashboard's Camp Year tab is the normal path (it validates and audits).            | `CAMP_YEAR`, `CAMP_YEAR_JSON` (path; shape in the file's header comment), `FIRESTORE_TEST_DATABASE_ID` (default `lyf-v2-test`)                                            |
| `migrateV1ToV2Database.ts`                  | The v1 → v2 ETL. Still the way to (re)seed `lyf-v2-test` from v1's `internal-test` with the admin roster copied from `lyf-v2`. Idempotent merge writes; refuses to run when source and target are the same. | `APPLY`, `SOURCE_DB` (default `(default)`), `TARGET_DB` (default `lyf-v2`), `ADMINS_FROM_DB` (optional)                                                                   |
| `backfillFamilyCreatedBy.ts`                | After the `createdBy` field was introduced (October 2026): stamps it on legacy single-email families, prints multi-email ones for manual review. Run once per database, then retire.                        | `APPLY`, `FIRESTORE_DATABASE_ID` (default `lyf-v2`)                                                                                                                       |
| `backfillRegistrationDenormalizedFields.ts` | After schemaVersion 3 (October 2026): copies the camper profile fields and `parentContacts` onto older registrations so the admin grid needs no fan-out. Idempotent. Run once per database, then retire.    | `APPLY`, `FIRESTORE_DATABASE_ID` (default `lyf-v2`)                                                                                                                       |
| `backfillIsReturning.ts`                    | October 2026 legacy field-type repairs: string `isReturning` to boolean, NaN `grade` and false `hasContacted` deleted, string credit `amountRemaining` to number. Idempotent. Run once per database.        | `APPLY`, `FIRESTORE_DATABASE_ID` (default `lyf-v2`)                                                                                                                       |
| `cleanupLegacyCamperFields.ts`              | Phase 2 of the RBAC split (September 2026): deletes health/demographics fields from camper and registration documents once the `private/` copies exist. Run once per database, then retire.                 | `APPLY` or `--apply`, `FIRESTORE_DATABASE_ID` (default `lyf-v2`)                                                                                                          |

The four backfills are kept until someone confirms they have been applied to
both `lyf-v2` and `lyf-v2-test`; after that, move them to `src/archive/`.

## Emulator seeding (shell scripts)

Both talk to the Firestore emulator's REST API with the `owner` bearer token,
so they need `firebase emulators:start` running first
([docs/local-development.md](../docs/local-development.md#emulators)).

| Script                     | What it writes                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed-emulator.sh [email]` | `admins/{email}` as `full_admin` (default `test@tacl.org`), `config/site` and two sample `camps/{year}` documents so the pages resolve a schedule. |
| `seed-emulator-data.sh`    | Fake families, campers and registrations for the admin dashboard. Run after `seed-emulator.sh`.                                                    |

`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` override the defaults
(`lyf-registration`, `lyf-v2`).

## Archived scripts

`src/archive/` holds scripts that were executed once against a specific camp
year or the v1 `(default)` database. They are excluded from the build
(`tsconfig.json`) and from Prettier, and they are **not** safe to run again:
most hardcode a year and would write to the v1 database through
`admin.firestore()`.

| Script                              | What it did                                                                                                                                                                                   | Targeted      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `addCamperNameToRegistrations.ts`   | Denormalised `camperName` onto every registration.                                                                                                                                            | v1, 2023      |
| `addFieldsToRegAndCamper.ts`        | Set `createdAt` on registrations from document metadata and linked campers to their registrations.                                                                                            | v1, 2023      |
| `combineRegWithPreReg.ts`           | Camp 2023: merged separate pre-registration documents into the full registration (`isPreRegistration` → `isPreRegistered`).                                                                   | v1, 2023      |
| `convertPreRegistrations.ts`        | Camp 2023 follow-up: converted the remaining `isPreRegistration` flags.                                                                                                                       | v1, 2023      |
| `getRemainingPreReg.ts`             | Camp 2024 report: pre-registered campers without a full registration, and their parents' emails.                                                                                              | v1, 2024      |
| `addWaitlistTime.ts`                | Camp 2025: backfilled `waitlistTime` on waitlisted registrations.                                                                                                                             | v1, 2025      |
| `convertSheetToPreRegistrations.ts` | Camp 2025: created pre-registrations and payments from a spreadsheet export and subscribed the parents in Mailchimp.                                                                          | v1, 2024–25   |
| `getPreRegistrationRate.ts`         | Camp 2025 report: share of active campers who had pre-registered for the next year.                                                                                                           | v1, 2025      |
| `addCreditForEmail.ts`              | Loaded a hardcoded list of camp-credit balances carried over from 2022–23. Contains real parent emails and camper names.                                                                      | v1, 2023      |
| `migrateToRbac.ts`                  | First RBAC restructure in place (health/demographics to `private/`, roles on admins, email casing). Superseded by `migrateV1ToV2Database.ts`, which does the same transforms during the copy. | 2026-05 to 09 |
| `utils.ts`                          | `writeOutput`/`appendToOutput` helpers used only by the archived scripts.                                                                                                                     |               |
