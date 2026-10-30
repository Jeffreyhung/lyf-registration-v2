# Legacy code: what was removed or archived

Nothing here is needed to run or deploy the system. It is listed so the next
person does not have to wonder where it went.

## Removed from the tree (still in git history)

| What                                                                                      | Was                                                                                                                                        | Why it is gone                                                                                                                                                                                                | How to get it back                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `migration/`                                                                              | Python scripts (`migration.py`, `parsers/`) that loaded the legacy Postgres CSV exports into the original (v1) Firestore database in 2023. | That migration ran once, three years ago, against the v1 database. The v1 → v2 move is a different tool, `scripts/src/migrateV1ToV2Database.ts`, and the CSV inputs and key file it needed were never in git. | `git log --diff-filter=D --oneline -- migration/` then `git show <commit>^:migration/migration.py` |
| `functions/firebase.json`, `functions/.firebaserc`                                        | A second Firebase config inside the functions workspace, from before the root `firebase.json` existed.                                     | The root `firebase.json` is what CI and `yarn deploy:*` use and already lists the `v2` codebase, both databases and the emulators. The Firebase CLI finds it from any subdirectory.                           | git history                                                                                        |
| `*/yarn.lock` in `website/`, `functions/`, `schemas/`, `scripts/`, `small-group-pairing/` | Lockfiles from before the workspaces were joined (untouched since May 2026).                                                               | Yarn workspaces resolve everything from the root `yarn.lock`; nested lockfiles are ignored by yarn but confuse Dependabot and readers.                                                                        | git history                                                                                        |
| Per-workspace `.prettierrc`, `website/.nvmrc`                                             | Four slightly different Prettier configs and a second Node version pin.                                                                    | Replaced by the root `.prettierrc` (with per-directory overrides that keep each workspace's existing style) and the root `.nvmrc`.                                                                            | n/a                                                                                                |

## Archived in place

- `scripts/src/archive/`: Admin SDK scripts that were run once against a
  specific camp year or the v1 database and must not be run again. They are
  excluded from the scripts build. The list, with what each one did, is in
  [scripts/README.md](../../scripts/README.md#archived-scripts).
