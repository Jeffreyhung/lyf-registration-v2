# Local development

Everything runs from the repository root with yarn 1 workspaces. The
workspace-specific notes that used to live in `functions/README.md` and
`website/README.md` are folded in here.

## Prerequisites

| Tool             | Why                                                                                                                                                | Install                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `nvm` + Node 22  | CI runs Node 22; the root `.nvmrc` pins it. `nvm install` then `nvm use` in the repo.                                                              | [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating) (`brew install nvm` on a Mac) |
| yarn 1 (classic) | The workspaces and the lockfile are yarn 1 format.                                                                                                 | `npm install -g yarn`                                                                                         |
| Firebase CLI     | Emulators and deploys. `firebase-tools` is also a dependency of `functions/`, so `yarn firebase ...` from the root works without a global install. | `npm install -g firebase-tools` (optional)                                                                    |
| gcloud CLI       | Application Default Credentials for the Admin SDK scripts.                                                                                         | [Install guide](https://docs.cloud.google.com/sdk/docs/install-sdk)                                           |
| Java 21          | The Firestore emulator (rules tests) is a JVM program.                                                                                             | Any JDK/JRE 21, e.g. Temurin                                                                                  |

Access: members of the `lyf.technology@tacl.org` Google group already have
what they need on the `lyf-registration` GCP project. Anyone else needs the
**Firebase Develop Admin** role granted in
[IAM](https://console.cloud.google.com/iam-admin/iam?project=lyf-registration).
Then:

```bash
gcloud auth application-default login   # Admin SDK scripts, emulator seeding
firebase login                          # deploys and emulators with the real project
```

## Install and build

```bash
nvm install
yarn install            # at the root; installs every workspace (.yarnrc sets --ignore-engines)
yarn build:packages     # schemas/dist and small-group-pairing/dist
```

Order matters: `functions/`, `website/` and `scripts/` import
`lyf-registration-schemas` and `small-group-pairing` from their `dist/`
folders, so rebuild them after changing anything in `schemas/src` or
`small-group-pairing/src`. `yarn typecheck` and `yarn workspace functions test`
do that build for you; `gatsby develop` does not.

## Environment files

| File             | Copy from                | Used by                                                                                                                                                                                             |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `website/.env`   | `website/.env.example`   | `gatsby develop` / `gatsby build`: Firebase web config, the two database ids, Stripe publishable key, `GATSBY_USE_EMULATORS`.                                                                       |
| `functions/.env` | `functions/.env.example` | Loaded by dotenv at runtime and by the Firebase CLI at deploy time (trigger database bindings come from it): database ids, Stripe keys and webhook secrets, Gmail OAuth, Mailchimp, Slack webhooks. |

The values are in the Bitwarden item `lyf-registration env var`. Both files
are git-ignored; never commit them, and never commit an Admin SDK key file
(the root `.gitignore` refuses the usual name).

## Everyday commands

| Command                                              | What it does                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `yarn typecheck`                                     | `build:packages`, then `tsc --noEmit` for `functions/` and the website.                                                       |
| `yarn lint`                                          | `yarn workspace functions lint` (ESLint, correctness rules only) and the website `lint` script when present.                  |
| `yarn test`                                          | Jest in `schemas/`, `functions/` and `small-group-pairing/`, plus the website `test` script when present.                     |
| `yarn format:check` / `yarn format`                  | Prettier with the root `.prettierrc`; `.prettierignore` excludes `functions/` and the areas not formatted yet.                |
| `yarn workspace lyf-registration-website develop`    | Gatsby dev server at http://localhost:8000.                                                                                   |
| `yarn emulators`                                     | `functions:isolate` (build + isolate + copy `functions/.env`), then `firebase emulators:start` from the root `firebase.json`. |
| `yarn workspace firestore-rules-tests test:emulator` | Security rules suite inside `firebase emulators:exec` (project `demo-lyf-rules`).                                             |
| `yarn workspace functions build:watch`               | `tsc --watch` for the functions while an emulator is running.                                                                 |

## Website

```bash
cd website
yarn develop                              # against the real test database, per website/.env
GATSBY_USE_EMULATORS=true yarn develop    # against the local emulators
```

The site reads `GATSBY_FIRESTORE_DATABASE_ID` / `GATSBY_FIRESTORE_TEST_DATABASE_ID`
(`lyf-v2` / `lyf-v2-test`) and switches between them with the admin
dashboard's test-data toggle. `src/gatsby-types.d.ts` is generated by Gatsby's
`graphqlTypegen` on each run and is git-ignored. The TypeScript config is not
`strict` yet; path aliases `@components/*`, `@hooks/*`, `@utils/*` are defined
in `website/tsconfig.json`.

## Functions

- Source in `functions/src`, entry `functions/src/index.ts`; shared Firestore,
  Stripe and Slack clients in `functions/src/utils.ts`. Deployed names end in
  `V2` because v1's functions of the same base names still run in the project;
  the website resolves them through `FUNCTION_NAMES` in
  `schemas/src/functions.ts`. Keep the two lists in sync.
- Unit tests (`functions/test/unit`, jest + ts-jest via `tsconfig.test.json`)
  need no emulator: `yarn workspace functions test`. They live outside `src/`
  so they are excluded from the production build and the isolate bundle.
- Lint with `yarn workspace functions lint`. The flat config
  (`functions/eslint.config.mts`) applies the `@eslint/js`, `typescript-eslint`
  and `eslint-plugin-react` recommended rules and nothing stylistic;
  `eslint-config-google` is in `devDependencies` but not loaded. The code is
  written in that Google style (semicolons, `{noSpaces}` braces, double
  quotes) by convention, so match the surrounding file by hand and do **not**
  run Prettier in `functions/`.
- Emulator smoke test: with `yarn emulators` running, `functions/test/run.sh`
  builds and runs `functions/test/addEmulatorData.js`.
- Deploying uses [isolate-package](https://github.com/0x80/isolate-package):
  the root `firebase.json` predeploy hooks build the schemas, lint, build and
  isolate the functions into `functions/isolate/` (git-ignored) so the
  workspace dependency resolves outside the monorepo. All imports inside
  `functions/src` must therefore be local or published packages.
- Email templates are [MJML](https://mjml.io/) + Mustache under
  `functions/src/emailTemplates`. They are not TypeScript, so the `copy-files`
  script copies `.html`/`.mjml` into `lib/` as part of `yarn build`. The
  VS Code MJML extension or [MJML's live editor](https://mjml.io/try-it-live)
  renders them while editing.

## Emulators

`firebase.json` at the root defines the emulator ports (functions 5001,
Firestore 8080, auth 9099, UI on). `yarn emulators` starts them with the
isolated functions bundle. Seed data with the two shell scripts in `scripts/`
(`seed-emulator.sh [email]` for an admin, `config/site` and two camp years;
`seed-emulator-data.sh` for fake families and registrations), see
[scripts/README.md](../scripts/README.md#emulator-seeding-shell-scripts).

## Admin SDK scripts

Maintenance scripts against the real databases live in `scripts/`; they run
with your gcloud Application Default Credentials and are dry-run by default.
[scripts/README.md](../scripts/README.md) lists each one with its environment
variables.

## Conventions

- **Formatting.** Root `.prettierrc` (2 spaces, no semicolons; the
  `small-group-pairing/` and `scripts/` overrides keep their `{noSpaces}`
  bracket style). `functions/` is linted, not formatted (see Functions above).
  `.prettierignore` still lists the workspaces whose files predate the check;
  format one area per PR and delete its line.
- **Pre-commit hook.** `yarn install` installs husky; `.husky/pre-commit` runs
  lint-staged: ESLint on staged `functions/` files, `prettier --check` on
  everything else that `.prettierignore` allows.
- **Shared types.** Firestore document types in `schemas/` are `Partial<...>`
  on purpose; the runtime validators (`validateXWrite` / `validateXRead`,
  zod-based) are what keep writes honest. Add a field in both places or the
  schemas build fails ([schemas/README.md](../schemas/README.md)).
- **Roles.** `ROLE_CAPABILITIES` in `schemas/src/admin.ts` mirrors
  `firestore.rules`; a capability change touches both and the rules tests.
- **Two databases.** Any data or config change (admin roster, `config/site`,
  `camps/{year}`, backfills) has to be made in `lyf-v2` **and** `lyf-v2-test`.
  Only the admin roster is mirrored automatically (`replicateAdminsToTest`).
