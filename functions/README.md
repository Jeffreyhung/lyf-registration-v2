We'll use Cloud Functions to react to Registrations

# Getting Started
Follow the [Firebase docs](https://firebase.google.com/docs/functions/get-started)

1. install `nvm` if you haven't
  - Here's the [officail instruction](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating), or if you are a Mac and homebrew user (highly suggested if you are not) you can install with `brew install nvm`
  - once installed, you can verify the installation with `nvm -v`
2. install the node version we use with `nvm install`
  - nvm picks the version up from the `.nvmrc` at the repository root (Node 22, matching the `nodejs22` runtime the functions deploy to); if not, run `nvm install 22`
  - once installed, you can verify the installation with `node -v`, you should see a `v22.x` version
3. install `yarn` with `npm install -g yarn` if you haven't
  - once installed, you can verify the installation with `yarn -v`
4. Install firebase tools `npm install -g firebase-tools`
5. Install the dependencies with `yarn install`
6. Install gcloud-cli, [instructions](https://docs.cloud.google.com/sdk/docs/install-sdk)
7. Make sure you have the right permission in GCP
   - If you are part of the `lyf.technology@tacl.org` group, you should have all the permissions you need
   - If you are not, you will need to be granted with `Firebase Develop Admin` permission in the [`lyf-registration` GCP Project](https://console.cloud.google.com/iam-admin/iam?project=lyf-registration)
8. Run `gcloud auth application-default login` to authenticate your device/terminal with GCP 
9. Login with your TACL account `firebase login`
10. Since the functions directory is already initialized, there's no need to run `firebase init functions`
11. Keys for the `.env` file can be found in the Bitwarden item `lyf-registration env var`.

# Unit tests

Pure logic that guards registration (pricing, payload limits, admin-gated
flags, family membership) has jest tests under [test/unit](test/unit/). They
need no emulator and run in CI on every change to `functions/` or `schemas/`:

```
yarn workspace functions test
```

Tests live outside `src/` so they are excluded from the production build and
the isolate bundle; `tsconfig.test.json` is used only by ts-jest.

# Emulator testing

1. Start the firebase emulators with `firebase emulators:start`
   - May need to download the emulators with `firebase init emulators`
2. Run the test script by going to the test directory and running with `./run.sh`

This test script initializes the database with some test data then adds Zeffy orders to test out the cloud function. Because everything is [locally emulated](https://firebase.google.com/docs/functions/local-emulator), we can have quick development! 

Firebase docs on local Cloud Function emulation: https://firebase.google.com/docs/functions/local-emulator

- All imports must be local for isolate package to work
- We use isolate to make sure that our monorepo workspaces are found when deploying functions.
- Our [firebase.json](./firebase.json) has a set of pre-deploy commands which will lint, build, and isolate our functions before publishing from the ./isolate directory.

# Email templates (MJML + Mustache)

Emails are written in [MJML](https://mjml.io/) with [Mustache](https://mustache.github.io/) placeholders, in [src/emailTemplates](src/emailTemplates/). You can install the VSCode MJML extension to live-render a file as you edit it, or paste it into [MJML's live editor](https://mjml.io/try-it-live).

The MJML is compiled to HTML at build time, not in the deployed functions: `yarn build:templates` (run by `yarn build` and by the jest global setup) writes `src/emailTemplates/*.html` (gitignored), `copy-files` copies the HTML into `lib/`, and `src/registrationUtils/emailTemplates.ts` reads a template the first time it is needed. This keeps `mjml` out of the production bundle and off the cold-start path. After editing a `.mjml` file, run `yarn build:templates` (or `yarn build`) to see the change.
