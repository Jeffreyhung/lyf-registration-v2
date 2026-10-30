# Contributing

1. **Set up** following [docs/local-development.md](docs/local-development.md).
   Node 22 (`.nvmrc`), yarn 1, `yarn install` at the repo root.
2. **Branch from `main`.** Development happens on the fork
   (`origin`, `Jeffreyhung/lyf-registration-v2`); `upstream`
   (`TACL-LYF/lyf-registration-v2`) is never pushed to directly.
3. **Before pushing** run what CI runs:
   `yarn typecheck`, `yarn lint`, `yarn test`, `yarn format:check`, and
   `yarn workspace firestore-rules-tests test:emulator` if you touched
   `firestore.rules`. The pre-commit hook (husky + lint-staged) checks staged
   files: ESLint in `functions/`, Prettier everywhere `.prettierignore` allows.
4. **Open a pull request against `main`** and fill in the template. The
   checklist exists because the same mistakes keep coming back: a change made
   in `lyf-v2` but not `lyf-v2-test`, a schema change without the matching
   rules and validators, a renamed callable without its `FUNCTION_NAMES`
   entry.
5. **Merging deploys.** A merge to `main` publishes the website and, when
   `functions/`, `schemas/` or the Firestore files changed, deploys them
   ([docs/deployment.md](docs/deployment.md)). Data backfills are not part of
   a deploy: list them in the PR and run them from `scripts/`
   ([scripts/README.md](scripts/README.md)).

Conventions worth knowing before the first PR are summarised in
[CLAUDE.md](CLAUDE.md).
