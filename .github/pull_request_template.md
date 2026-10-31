## What

<!-- One or two sentences. Link the issue if there is one. -->

## Why

## How it was tested

<!-- Commands run (`yarn lint`, `yarn typecheck`, `yarn test`, `yarn format:check`),
     emulator / test-database checks, screenshots for UI changes. -->

## Checklist

- [ ] CI is green, or the failing job is explained above
- [ ] Both Firestore databases considered: does `lyf-v2-test` need the same data or config change as `lyf-v2`? (the admin roster, `config/site` and `camps/{year}` exist in each)
- [ ] Document shape or role capability changed → validators in `schemas/`, `firestore.rules` and `firestore-rules-tests/` updated together
- [ ] Callable added or renamed → `FUNCTION_NAMES` in `schemas/src/functions.ts` and the `V2` export in `functions/src/index.ts` match
- [ ] New secret or variable → `functions/.env.example`, `.github/workflows/deploy-firebase.yml` and `docs/deployment.md` updated
- [ ] Manual steps for the deployer (backfill script, console change, Stripe/Slack setup) listed above
