# functions

Cloud Functions (2nd gen, Node 22, codebase `v2`) that react to registrations:
the `createRegistrationSession` / `createPreRegistrationSession` callables,
the Stripe webhooks that fulfil payments, the admin callables (`manageAdmin`,
`manageCampYear`, `issueStripeRefund`, `moveCampersOffWaitlist`) and the
Firestore triggers that keep denormalised fields and the test-database admin
roster in sync. Entry point: [src/index.ts](src/index.ts); every export carries
a `V2` suffix and is listed in `FUNCTION_NAMES` in the schemas package.

- **Setup (Node, yarn, gcloud, `.env`), emulators, conventions:**
  [docs/local-development.md](../docs/local-development.md#functions)
- **What the registration function does, step by step:**
  [docs/architecture-registration.md](../docs/architecture-registration.md#backend-architecture)
- **Deploying and the secrets it needs:** [docs/deployment.md](../docs/deployment.md)

## Working in this workspace

```bash
yarn workspace functions lint      # eslint (recommended rules); never run prettier here
yarn workspace functions test      # builds ../schemas, then jest on test/unit
yarn --cwd functions tsc --noEmit  # type-check the production build
yarn emulators                     # from the repo root: isolate + emulators
```

Unit tests live in [test/unit](test/unit/) (outside `src/` so they stay out of
the production build and the isolate bundle; `tsconfig.test.json` is used only
by ts-jest). `test/run.sh` is the emulator smoke test (`addEmulatorData.js`).

Deploys go through [isolate-package](https://github.com/0x80/isolate-package):
the root `firebase.json` predeploy hooks lint, build and isolate this workspace
into `isolate/` so the `lyf-registration-schemas` dependency resolves outside
the monorepo. Keep imports local or published.

Email templates are [MJML](https://mjml.io/) + Mustache under
[src/emailTemplates](src/emailTemplates/), compiled to HTML at build time rather
than in the deployed functions: `yarn build:templates` (run by `yarn build` and
by the jest global setup) writes `src/emailTemplates/*.html` (git-ignored),
`copy-files` copies the HTML into `lib/`, and
`src/registrationUtils/emailTemplates.ts` reads a template the first time it is
needed. This keeps `mjml` out of the production bundle and off the cold-start
path. After editing a `.mjml` file, run `yarn build:templates` (or `yarn build`)
to see the change; the VS Code MJML extension or
[MJML's live editor](https://mjml.io/try-it-live) render a file as you edit it.
