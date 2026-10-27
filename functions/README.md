We'll use Cloud Functions to react to Registrations

# Getting Started
Follow the [Firebase docs](https://firebase.google.com/docs/functions/get-started)

1. install `nvm` if you haven't
  - Here's the [officail instruction](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating), or if you are a Mac and homebrew user (highly suggested if you are not) you can install with `brew install nvm`
  - once installed, you can verify the installation with `nvm -v`
2. install the node version we use with `nvm install`
  - nvm should pick up the node version from the `.nvmrc` file, if not, try `nvm install 22.22.0`
  - once installed, you can verify the installation with `node -v`, you should see `v22.22.0`
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

# MJML

We use a combination of [MJML](https://mjml.io/) and [Handlebars](https://handlebarsjs.com/) to style our emails. Email templates can be found in [src/emailTemplates](src/emailTemplates/). You can install the VSCode MJML extension to live-render the file as you edit it or copy and paste the file to [MJML's own live editor](https://mjml.io/try-it-live).

# Copying over non-TS non-JS files

We have a few HTML and MJML templates. Since these don't get built with TypeScript, we need to manually copy them over.
Our package.json "copy-files" scripts takes care of this.
