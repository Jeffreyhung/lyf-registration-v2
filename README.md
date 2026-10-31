# lyf-registration

Registration system for the TACL LYF summer camp: a Gatsby website where
families register campers and pay through Stripe, Firebase Cloud Functions that
create the registrations and fulfil the payments, and an admin dashboard for
the program directors. Everything lives in this yarn 1 workspaces monorepo.

## Workspaces

| Directory                | Package                    | What it is                                                                                                                                                               |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `website/`               | `lyf-registration-website` | Gatsby 5 / React 18 / MUI site: registration and pre-registration flows, parent profile, admin dashboard at `/admin`. Deployed to GitHub Pages.                          |
| `functions/`             | `functions`                | Cloud Functions (2nd gen, Node 22, codebase `v2`): registration callables, Stripe webhooks, admin callables, Firestore triggers. Exports carry a `V2` suffix.            |
| `schemas/`               | `lyf-registration-schemas` | Shared TypeScript types, runtime validators, role capabilities and the callable names (`FUNCTION_NAMES`). Built to `dist/`; every other workspace imports it from there. |
| `small-group-pairing/`   | `small-group-pairing`      | Pure TypeScript small-group pairing algorithm used by the admin dashboard. Built to `dist/`.                                                                             |
| `scripts/`               | `lyf-registration-scripts` | Firebase Admin SDK maintenance scripts and emulator seed scripts. [scripts/README.md](scripts/README.md).                                                                |
| `firestore-rules-tests/` | `firestore-rules-tests`    | Emulator tests for `firestore.rules`.                                                                                                                                    |

Root-level Firebase files: `firebase.json` (both named databases, the `v2`
functions codebase, emulator ports), `firestore.rules`, `firestore.indexes.json`.

## Quick start

```bash
nvm install          # Node 22, from .nvmrc
yarn install         # every workspace, always from the repo root
yarn build:packages  # schemas + small-group-pairing dist/, needed by everything else
yarn typecheck && yarn lint && yarn test
```

Then follow [docs/local-development.md](docs/local-development.md) for the
`.env` files, Google Cloud access, the emulators, running the site and the
full table of everyday commands.

## Data and environments

Two named Firestore databases in the `lyf-registration` Firebase project:
`lyf-v2` (production) and `lyf-v2-test`. The admin dashboard's test-data
toggle and the `isTestData` flag on callable payloads select the test database,
Stripe test mode and the test Slack channels, so a full registration can be
rehearsed without touching production. Camp configuration is data, not code:
`config/site` points at the current and pre-registration camp years and
`camps/{year}` holds each year's dates, fees and caps
([docs/admin-runbook.md](docs/admin-runbook.md#camp-year-rollover)).

## Documentation

- [docs/local-development.md](docs/local-development.md): prerequisites, install, env files, emulators, conventions.
- [docs/architecture-registration.md](docs/architecture-registration.md): the registration flow end to end (website → `createRegistrationSession` → Stripe → webhook).
- [docs/admin-runbook.md](docs/admin-runbook.md): admin dashboard, exports, the yearly camp-year rollover, test mode.
- [docs/deployment.md](docs/deployment.md): workflows, secrets and variables, Workload Identity Federation setup.
- [docs/website-strict-mode.md](docs/website-strict-mode.md): which TypeScript strict flags and lint rules the website has on, and the plan for the rest.
- [docs/functions-upgrade-plan.md](docs/functions-upgrade-plan.md): checklist for the pending firebase-functions / firebase-admin / Stripe major upgrades.
- [docs/firestore-to-cloud-sql-assessment.md](docs/firestore-to-cloud-sql-assessment.md): why the data stays in Firestore.
- [docs/legacy/README.md](docs/legacy/README.md): what was removed or archived, and where to find it.
- [schemas/README.md](schemas/README.md): the shared types and runtime validators.
- [scripts/README.md](scripts/README.md): the Admin SDK maintenance scripts and emulator seeding.
- [CLAUDE.md](CLAUDE.md): the condensed orientation written for AI coding assistants; also a good five-minute read for people.
- [AGENTS.md](AGENTS.md): the longer version for contributors and coding agents: what must stay in sync, gotchas, safety rules.

## Contributing

Branch from `main`, open a pull request against `main` and fill in the
template; CI (`ci.yml`, `codeql.yml`, and `test-firestore-rules.yml` when the
rules change) must be green. Merging to `main` deploys automatically, see
[docs/deployment.md](docs/deployment.md). More in
[CONTRIBUTING.md](CONTRIBUTING.md).
