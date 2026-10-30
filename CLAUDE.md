# CLAUDE.md

Orientation for AI coding assistants (and new humans). Derived from the repo;
when this file and the code disagree, the code wins and this file needs a fix.

## What this is

Camp registration system for TACL LYF: families register campers and pay via
Stripe; program directors run camp from an admin dashboard. Yarn 1 workspaces
monorepo. Fork `Jeffreyhung/lyf-registration-v2` is `origin`;
`TACL-LYF/lyf-registration-v2` is `upstream` and is never pushed to directly.
Pull requests target `main`; merging to `main` deploys (see Deploy below).

## Workspace map

| Dir                      | Package                    | Notes                                                                                                     |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `website/`               | `lyf-registration-website` | Gatsby 5, React 18, MUI 7, Firebase web SDK 10, Stripe.js, Sentry. TS `strict` is off. GitHub Pages.      |
| `functions/`             | `functions`                | Cloud Functions 2nd gen, Node 22, codebase `v2`. Entry `src/index.ts`, shared clients `src/utils.ts`.     |
| `schemas/`               | `lyf-registration-schemas` | Shared types, zod validators, `ROLE_CAPABILITIES`, `FUNCTION_NAMES`. Built to `dist/`.                    |
| `small-group-pairing/`   | `small-group-pairing`      | Pure TS pairing algorithm. Built to `dist/`.                                                              |
| `scripts/`               | `lyf-registration-scripts` | Admin SDK maintenance scripts (ADC auth, dry-run by default). `src/archive/` is history, not built.       |
| `firestore-rules-tests/` | `firestore-rules-tests`    | Emulator tests for `firestore.rules`.                                                                     |
| `tools/`, `docs/`        |                            | Root helper scripts; long-form docs (architecture, admin runbook, deployment, local development, legacy). |

## Commands and their order

```bash
yarn install            # root only; never `yarn add` inside a workspace folder
yarn build:packages     # schemas + small-group-pairing dist/ FIRST: functions, website, scripts import them
yarn typecheck          # build:packages, then tsc for functions and website
yarn lint               # ESLint in functions/ (+ website lint when present)
yarn test               # jest: schemas, functions (test/unit), small-group-pairing (+ website when present)
yarn format:check       # prettier, scope defined by .prettierignore
yarn workspace functions test            # builds schemas itself, then jest
yarn workspace firestore-rules-tests test:emulator   # needs Java
yarn emulators          # isolate functions + firebase emulators:start (root firebase.json)
```

CI (`.github/workflows/ci.yml`) runs exactly these per workspace, plus
`codeql.yml` and, when rules change, `test-firestore-rules.yml`.

## Data model essentials

- Firebase project `lyf-registration`, two **named** Firestore databases:
  `lyf-v2` (prod) and `lyf-v2-test`. `(default)` and `internal-test` belong to
  the still-running v1 system; never write to them from v2 code.
- The **test-data toggle**: `isTestData` on documents and callable payloads
  selects `lyf-v2-test`, the Stripe test keys and the test Slack channels.
  Functions have test twins (`handleTestStripeWebhookV2`, `*OnUpdateTestV2`)
  bound to the test database. Every data or config change must be made in
  both databases; only the admin roster is mirrored automatically.
- **Config lives in Firestore, not code**: `config/site` (`currentCampYear`,
  `preRegistrationCampYear`) and `camps/{year}` (dates, fees, caps,
  `remainingSpots`, image URLs, display toggles). Written only by the
  `manageCampYear` callable; `remainingSpots` only by registration functions.
  Late-registration bypass list: `camps/{year}/private/bypass/emails/{email}`.
- **Roles**: `admins/{email}` with `role` in `full_admin`, `program_admin`,
  `program_staff`, `health_staff`. `ROLE_CAPABILITIES` in
  `schemas/src/admin.ts` mirrors `firestore.rules`; change both plus
  `firestore-rules-tests/rules.test.ts` together. Health and demographics
  live under `families/{f}/campers/{c}/private/`.
- **Document types are `Partial<...>`** by design; the zod validators
  (`validateXWrite` / `validateXRead`) are the real contract and are pinned to
  the types at compile time.

## Functions naming

Every deployed function is exported from `functions/src/index.ts` with a `V2`
suffix (v1 functions with the same base names run in the same project and
region). The website calls them through `FUNCTION_NAMES` in
`schemas/src/functions.ts`. Adding or renaming a callable means editing both.

## Conventions

- `functions/`: eslint-config-google style via `yarn workspace functions lint`.
  **Never run Prettier in `functions/`.**
- Everything else: Prettier, root `.prettierrc` (2 spaces, no semicolons;
  `small-group-pairing/` and `scripts/` keep `bracketSpacing: false`).
  `.prettierignore` lists the areas not formatted yet; do not reformat them as
  a side effect of another change.
- Pre-commit (husky + lint-staged): ESLint on staged `functions/` files,
  `prettier --check` on the rest.
- Secrets only in `functions/.env` / `website/.env` (git-ignored; examples
  checked in). Admin SDK scripts authenticate with gcloud ADC; no key files.
- Tests: `functions/test/unit/*.test.ts` (fake Firestore in `fakeFirestore.ts`),
  `schemas/test`, `small-group-pairing/tests`. Keep tests out of `src/`.
- Scripts that write data: dry run by default, `APPLY=1` to write, database
  chosen by env var; document usage in the file header and `scripts/README.md`.

## Deploy

On merge to `main`: `deploy-website.yml` (GitHub Pages) and, when
`functions/`, `schemas/` or Firestore files changed, `deploy-firebase.yml`
(Workload Identity Federation; it writes `functions/.env` from GitHub secrets
and refuses to deploy if one is empty). Never deploy from a branch or a laptop
unless `docs/deployment.md` says so. New secret → `functions/.env.example`,
the workflow and `docs/deployment.md`.

## Read next

`README.md` → `docs/local-development.md` → `docs/architecture-registration.md`
(registration + payment flow) → `docs/admin-runbook.md` (camp year rollover,
exports) → `docs/deployment.md` → `schemas/README.md` → `scripts/README.md`.
