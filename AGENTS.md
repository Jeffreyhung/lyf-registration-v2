# AGENTS.md

Guidance for people and AI coding agents working in this repository. It
complements the [README](README.md), the condensed [CLAUDE.md](CLAUDE.md) and
the long-form docs under [docs/](docs/); it does not repeat them. When this
file and the code disagree, the code wins — fix this file.

## What this repo is

`lyf-registration-v2` is the registration system for TACL LYF summer camp:
a Gatsby static site (parents register and pay, admins run the camp) backed by
Firebase (Auth, Firestore, Cloud Functions v2) and Stripe Checkout. There is
**no application server** — the browser talks to Firestore and Firebase Auth
directly, and Cloud Functions handle money, email, Slack and privileged writes.

v2 shares the Firebase project `lyf-registration` with the still-running v1
site. v1 owns the `(default)` and `internal-test` Firestore databases and the
unsuffixed function names; v2 owns the named databases `lyf-v2` (prod) and
`lyf-v2-test` (test) and deploys every function with a `V2` suffix. Until
cutover, `https://lyf-registration.tacl.org` is still v1 (Netlify, repo
`TACL-LYF/lyf-registration`) and v2 is served from GitHub Pages at the URL set
in `website/gatsby-config.ts`. If a Sentry issue's document URI is the tacl.org
host, look in the v1 repo first — both sites report to the same Sentry project.

## Workspace map

Yarn 1 workspaces, TypeScript project references, Node 22 (CI); local Node
may be newer because `.yarnrc` sets `--ignore-engines`.

| Workspace                | Package name               | What lives there                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas/`               | `lyf-registration-schemas` | Shared Firestore document types, callable payload types, zod validators, `ROLE_CAPABILITIES`, `FUNCTION_NAMES`, `normalizeEmail`, `CURRENT_SCHEMA_VERSION`. Everything else imports from its `dist/`.                                                                                                                                              |
| `functions/`             | `functions`                | Cloud Functions v2: callables (`createRegistrationSession`, `createPreRegistrationSession`, `moveCampersOffWaitlist`, `issueStripeRefund`, `manageAdmin`, `manageCampYear`), Stripe webhooks, Firestore triggers (`replicateAdminsToTest`, `syncFamilyEmails*`, `syncCamperProfile*`), MJML email templates. Unit tests in `functions/test/unit/`. |
| `website/`               | `lyf-registration-website` | Gatsby 5 + React 18 + MUI site. Pages: `/`, `/registration`, `/preregistration`, `/login`, `/admin`, `/user/profile`. Path aliases `@components/*`, `@hooks/*`, `@utils/*`. ESLint flat config in `eslint.config.mjs`; jest unit tests for pure modules in `test/unit/`.                                                                           |
| `firestore-rules-tests/` | `firestore-rules-tests`    | Role × collection matrix for `firestore.rules`, run against the Firestore emulator.                                                                                                                                                                                                                                                                |
| `small-group-pairing/`   | `small-group-pairing`      | Pure TS pairing algorithm used by the admin dashboard.                                                                                                                                                                                                                                                                                             |
| `scripts/`               | `lyf-registration-scripts` | One-off Admin SDK migrations, seeding and backfills (`scripts/src/*.ts`; `src/archive/` is history and not built). Data exports moved to the dashboard. `scripts/run.sh` builds and runs one script; usage in `scripts/README.md`.                                                                                                                 |
| `docs/`                  | —                          | Long-form docs: local development, registration architecture, admin runbook (exports, camp year rollover), deployment, website strict-mode status, functions upgrade plan, the Firestore → Cloud SQL assessment, and `legacy/` (what was removed from the tree, e.g. the 2023 `migration/` import).                                                |

Root files that matter: `firestore.rules` and `firestore.indexes.json` (deployed
to **both** named databases per `firebase.json`), `firebase.json` (functions
predeploy hooks: build schemas, lint, build, isolate, copy `.env`), `.github/workflows/`.

## Setup and everyday commands

```bash
yarn install                                   # root, once
cp functions/.env.example functions/.env       # values: Bitwarden, see docs/local-development.md
cp website/.env.example website/.env
```

Build order matters: `schemas` and `small-group-pairing` must be built before
anything that imports them type-checks.

| Task                                     | Command                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build shared packages                    | `yarn workspace lyf-registration-schemas build` then `yarn workspace small-group-pairing build`                                                                                                                                       |
| Type-check everything                    | `yarn typecheck` (root)                                                                                                                                                                                                               |
| All unit tests                           | `yarn test` (root) — builds the packages, then jest in schemas, functions, small-group-pairing and website                                                                                                                            |
| One workspace's tests                    | `yarn workspace functions test` (builds schemas first), `yarn workspace lyf-registration-schemas test`, `yarn workspace small-group-pairing test`, `yarn workspace lyf-registration-website test` (needs `yarn build:packages` first) |
| Lint                                     | `yarn lint` (root) — ESLint in `functions/` and `website/`; `yarn workspace functions lint-fix` to autofix the functions                                                                                                              |
| Formatting                               | `yarn format:check` / `yarn format` (root; `.prettierignore` lists what is excluded)                                                                                                                                                  |
| Rules tests                              | `yarn workspace firestore-rules-tests test:emulator` (needs Java for the emulator)                                                                                                                                                    |
| Website dev server                       | `cd website && yarn develop` → http://localhost:8000 ; add `GATSBY_USE_EMULATORS=true` to point at local emulators                                                                                                                    |
| Website production build                 | `yarn workspace lyf-registration-website build`                                                                                                                                                                                       |
| Emulators (functions + firestore + auth) | `yarn emulators` (root; runs `functions:isolate` first), then `scripts/seed-emulator.sh` to seed `config/site`, sample camp years and admin docs                                                                                      |
| Admin SDK script                         | `cd scripts && ./run.sh -n <name>` (builds, sets `GOOGLE_CLOUD_PROJECT`, unsets the emulator host) with Application Default Credentials for a `tacl.org` account that has access to the project; there is no key file                 |

The pre-commit hook (`.husky/pre-commit`, installed by `yarn install`) runs
lint-staged on staged files only: ESLint for `functions/`, `prettier --check`
for everything `.prettierignore` allows. It does not type-check or run tests,
so run `yarn typecheck`, `yarn lint` and `yarn test` yourself before pushing.

Deploys are **not** run by hand from a checkout. Merge to `main` and GitHub
Actions deploys (see "CI and deployment").

## Things that must stay in sync

These pairs are enforced by convention, tests or `tsc`, not by a single source.
Change one, change the other in the same PR.

- **Function names.** `functions/src/index.ts` exports every function with a
  `V2` suffix; `schemas/src/functions.ts` (`FUNCTION_NAMES`) is how the website
  calls them. Adding or renaming a callable touches both.
- **Roles and capabilities.** `ROLE_CAPABILITIES` in `schemas/src/admin.ts` is
  the source of truth for what `full_admin`, `program_admin`, `program_staff`
  and `health_staff` may do. `firestore.rules` cannot import it, so its
  `hasRole`/`hasAnyRole`/`validRoles()` checks are mirrored by hand, and
  `firestore-rules-tests/rules.test.ts` asserts the matrix. Callables enforce
  the same capabilities through `assertAdmin` in `functions/src/utils/auth.ts`;
  the website through the role helpers in the schemas package. A new role or
  capability is a change in all four places.
- **Types and validators.** Every document type in `schemas/` has a zod
  validator in `schemas/src/validation.ts` pinned to the TS type at compile
  time. Adding a field to a type without adding it to the validator fails
  `tsc`, and vice versa. Writes go through `validateXWrite(...)` at the write
  boundary and callable input through `validateXPayload(...)`; follow the
  patterns in `schemas/README.md`.
- **Runtime secrets.** `functions/.env.example`, the secret check in
  `.github/workflows/deploy-firebase.yml` and the list in `docs/deployment.md`
  describe the same set of variables. A new env var goes in all three; the
  deploy refuses to run if any value is empty because an empty value would
  overwrite live configuration.
- **Named databases.** Functions bind triggers and clients via
  `FIRESTORE_DATABASE_ID` / `FIRESTORE_TEST_DATABASE_ID`; the website via the
  `GATSBY_FIRESTORE_*` equivalents. Never hardcode `(default)`.

## Data model facts and gotchas

- **Test mode is a first-class path.** The website's `useProduction` hook
  picks `lyf-v2` or `lyf-v2-test` plus live or test Stripe; callables take
  `isTestData` and pick the database, Stripe key, webhook secret and Slack
  channel from it. Every new function, trigger and dashboard feature needs to
  work in both modes. Triggers come in pairs (`...OnUpdate` / `...OnUpdateTest`).
- **Admins are resolved per database.** Rules do `get(/admins/{email})` in the
  database being hit and cannot read across databases. `lyf-v2/admins` is the
  roster's source of truth; the `replicateAdminsToTest` trigger mirrors it into
  `lyf-v2-test`. Never make a client or callable write the test roster
  directly. If test-mode admin reads fail with "insufficient permissions",
  check that trigger is deployed and the two rosters match before debugging
  rules.
- **`remainingSpots` goes negative in production.** Over-cap admissions are
  normal: live `camps/{year}` documents carry negative per-track counts, and
  older years store `remainingSpots` as a bare number rather than a
  `{Younger, Older}` map. Validators and rewrites must accept negative
  integers and the legacy shape; a `min(0)` check broke writes once already.
- **`camps/{year}` and `config/site` are public-read.** Nothing personal may be
  stored there. Configuration fields are written only by `manageCampYear`;
  `remainingSpots` only by the registration functions; `config/site` never
  from the client. Per-family bypass emails live under
  `camps/{year}/private/bypass/emails/{email}` so they cannot be enumerated.
- **Identity emails are normalized.** `Family.emails`, `Registration.familyEmails`,
  `Admin.addedBy`, audit `actor`/`target` etc. must be `normalizeEmail`-normalized
  on write. Read validators are lenient because legacy documents predate this.
- **Legacy documents exist.** Read with `{allowUnknownKeys: true}` where old
  fields may be present; do not add format checks (dates, phone numbers) that
  would reject documents the registration form re-submits.
- **Money and capacity are computed server-side.** Discounts, camp credit,
  waitlist placement and the registration window are decided in
  `functions/src/registrationUtils/` and `functions/src/registration/`; the
  client never sends a price. The close date is enforced both in the website
  and in `createRegistrationSession` (bypass list), so a direct call cannot
  skip it.
- **Camp years are data, not code.** Dates, fees, caps, images and display
  toggles come from `camps/{year}` and `config/site` (see "Camp year
  rollover" in `docs/admin-runbook.md`). Do not reintroduce hardcoded years or dates; the
  only remaining code-edited copy is the long notice text in `InfoStep.tsx`.

## Code style

Each workspace has its own conventions; match the file you are in.

- **`functions/`** is written in `eslint-config-google` style by convention:
  semicolons, double quotes, no spaces inside braces (`{db}`), trailing
  commas. Note that the flat config `functions/eslint.config.mts` only enables
  the `@eslint/js`, `typescript-eslint` and `eslint-plugin-react` recommended
  rules, so `yarn workspace functions lint` catches correctness problems but
  **not** style drift — copy the surrounding code. The workspace is **not**
  prettier-clean and must never be prettier-formatted.
- **`website/`, `schemas/`, `scripts/`, `small-group-pairing/`** have a
  `.prettierrc` (2 spaces, **no semicolons**; `scripts` and
  `small-group-pairing` also `bracketSpacing: false`). Format only the files
  you change, with that workspace's `.prettierrc`.
- TypeScript is strict in `functions/`. The website has every `strict`-family
  flag on except `strictNullChecks` (status and the ratchet plan in
  `docs/website-strict-mode.md`); CI type-checks and lints it, so keep both
  clean. Avoid `any` in new code (`no-explicit-any` warns and the inventory
  in that doc is at zero).
- Website lint: `yarn workspace lyf-registration-website lint`
  (`website/eslint.config.mjs`: js, typescript-eslint and react recommended
  rules plus `react-hooks`; the relaxed rules each carry a reason in the
  config).
- Comments explain _why_ (constraints, history, invariants), as the existing
  code does. Keep file-top comments that document cross-file invariants up to
  date when you move things.
- Website imports use the `@components/`, `@hooks/`, `@utils/` aliases.
- Firestore writes: build the object, wrap it in the matching
  `validate...Write`, then `set`/`update`. Use `FieldValue` sentinels for
  timestamps and array ops rather than client-computed values.
- Cloud Functions: callables use `callableOptions` from `utils/auth.ts`,
  translate `SchemaValidationError` into `HttpsError("invalid-argument")`,
  log with the Functions logger and report unexpected errors to Sentry and
  the error Slack channel as the existing handlers do. Tests live under
  `functions/test/unit/` (never under `src/`, which is the deploy bundle) and
  use `fakeFirestore.ts` instead of the emulator.
- Email templates are MJML + Mustache files under
  `functions/src/emailTemplates/`, compiled to HTML at build time by
  `yarn build:templates` (run by `yarn build` and the jest global setup;
  `mjml` is a devDependency and never ships). The generated `.html` is
  git-ignored and `copy-files` copies it into `lib/`, so a new template needs
  no build change but must keep the `.mjml` extension; after editing one, run
  `yarn build:templates` to see the change.

## Testing expectations

- Unit tests are required for pricing, capacity, window, validation and
  auth logic (`functions/test/unit/`, `schemas/test/`).
- Website pure modules (the registration reducer and session cache, exports,
  CSV, CSP, camp-time helpers) have jest tests in `website/test/unit/`
  (ts-jest via `tsconfig.test.json`, same `@components/` style aliases). There
  is no component test harness (no jsdom or testing-library), so describe
  manual verification of UI changes in the PR, and in which mode.
- `yarn workspace functions test` runs ts-jest **with type checking** and is
  slow on a cold cache. For fast iteration, point jest at a scratch config
  with `isolatedModules: true, diagnostics: false`, then do the final run
  with the repo config (or `tsc -p functions/tsconfig.test.json --noEmit`)
  before pushing.
- Any change to `firestore.rules`, `ROLE_CAPABILITIES` or the collections
  they guard needs the rules suite run against the emulator and, usually, a
  new case in `firestore-rules-tests/rules.test.ts`.
- `yarn typecheck` at the root is the cheapest full gate and mirrors CI.

## CI and deployment

- Pull requests run `ci.yml` (prettier format check; schemas build+test plus
  a build of `scripts/`; functions lint+test+typecheck; small-group-pairing
  build+test; website typecheck+lint+test; an advisory `yarn audit`),
  `codeql.yml` and, when rules files change, `test-firestore-rules.yml`.
  **Nothing deploys from a PR.**
- Pushes to `main` deploy: `deploy-website.yml` builds the Gatsby site to
  GitHub Pages on every push; `deploy-firebase.yml` deploys Cloud Functions
  (`v2` codebase) and Firestore rules/indexes only when their paths changed.
  Firebase auth is Workload Identity Federation; there is no service-account
  key anywhere in the repo or in Actions.
- CI installs with `yarn install --frozen-lockfile`, so a `package.json`
  change with a stale `yarn.lock` fails every job. Regenerate the lockfile
  with a real `yarn install`; **never hand-edit `yarn.lock`**.
- GitHub Actions are pinned to commit SHAs with a version comment; Dependabot
  bumps them weekly. Keep the comment when you update a pin.
- Deleted functions are removed on deploy (`--force`); renaming a function
  means the old name disappears from production.

## Git and pull request conventions

- Branch from `main`; one concern per PR; merge via PR (CI must be green).
- Commit messages: imperative subject that says what changed and why it
  matters ("Reject non-POST Stripe webhook requests before verifying the
  signature"). Agents add their co-author trailer.
- PR descriptions state what changed, how it was verified (which test
  suites ran, what was checked by hand and in which mode), and anything the
  reviewer must do (e.g. run `yarn install` and commit the lockfile, deploy
  order for data + code changes, admin roles to grant).
- Data-plus-code changes need a rollout order (rules → data → functions →
  website); write it down as the rollout appendix at the end of
  `docs/admin-runbook.md` does.
- This repo is commonly worked on from a fork with `origin` = the fork and
  `upstream` = `TACL-LYF/lyf-registration-v2`. `gh` defaults to `upstream`,
  so pass `--repo <owner>/lyf-registration-v2` explicitly when opening PRs or
  it reports "No commits between main and <branch>".
- Never commit `.env`, service-account keys, exports of real camper data or
  anything under `functions/isolate/`, `*/lib/`, `*/dist/`, `website/public/`.

## Working in a restricted agent environment

Some agent environments block the npm registry, local port binding or host
tools. What to do when that happens:

- **No registry access** means `yarn install`, `yarn add`, `yarn audit` and
  the functions `isolate` step (which runs `npm pack`) fail. Edit
  `package.json`, say in the PR that the lockfile must be regenerated, and
  leave the install to a human. A `node_modules` that predates a dependency
  (for example `zod` under `schemas/`) breaks the schemas build and everything
  downstream; check for that before blaming code.
- **Emulators** bind ports 8080 (Firestore), 9099 (Auth) and 5001 (Functions)
  and need Java. If they cannot run, say in the PR that the rules suite was
  not run rather than skipping it silently.
- **Long commands** (`gatsby build`, the type-checked jest run) should run in
  the background; type-check separately so feedback stays fast.
- **Admin SDK scripts against real data** use Application Default Credentials
  for an authorized `tacl.org` account with `GOOGLE_CLOUD_PROJECT=lyf-registration`
  and `FIRESTORE_EMULATOR_HOST` unset. Never commit or download a key file.
- If a tool (`gh`, `gcloud`, the emulator, the registry) is unavailable in your
  environment, report the step as not verified and ask the operator. Do not
  work around sandboxing, credentials or signing to get past it.

## Safety rules for agents

- **Production data is real families' data.** Do not run scripts against
  `lyf-v2` unless the task explicitly asks for it; prefer `lyf-v2-test` or
  the emulator, and say which database a script touched. Never paste camper,
  parent or health data into PRs, issues, commit messages or logs.
- Do not deploy, change Stripe/Slack/Mailchimp configuration, or edit GitHub
  Actions secrets or variables. Those are human steps; document what is
  needed instead.
- Do not weaken `firestore.rules` to make a feature work; move the write into
  a callable that checks a capability.
- Do not change `CURRENT_SCHEMA_VERSION`, document shapes or enum values
  without a backfill plan for existing documents in both databases.
- When something cannot be verified in your environment (emulator, audit,
  build), report it as not verified rather than retrying indefinitely.

## Where to look first

- Setup, env files, emulators, everyday commands and conventions:
  [docs/local-development.md](docs/local-development.md).
- Registration and payment flow end to end:
  [docs/architecture-registration.md](docs/architecture-registration.md).
- Admin dashboard, exports, camp-year rollover, test mode:
  [docs/admin-runbook.md](docs/admin-runbook.md).
- Workflows, secrets and variables, Workload Identity Federation:
  [docs/deployment.md](docs/deployment.md).
- Validation patterns and which fields are strict: [schemas/README.md](schemas/README.md).
- Admin SDK scripts and emulator seeding: [scripts/README.md](scripts/README.md).
- Website TypeScript and lint status: [docs/website-strict-mode.md](docs/website-strict-mode.md);
  pending functions framework upgrades: [docs/functions-upgrade-plan.md](docs/functions-upgrade-plan.md).
- Why the app stays on Firestore and what its scale is:
  [docs/firestore-to-cloud-sql-assessment.md](docs/firestore-to-cloud-sql-assessment.md).
- What was removed from the tree and where it went: [docs/legacy/README.md](docs/legacy/README.md).
- Role matrix as executable spec: `firestore-rules-tests/rules.test.ts`.
