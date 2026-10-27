# Camp year data files

One JSON file per camp year, in the shape `resetCampYearInfo` and
`seed-emulator.sh` read (the `CampYearConfigInput` keys from the schemas
package, with dates as ISO-8601 strings carrying a Pacific offset). Keys that
start with `_` are notes and are ignored by both loaders.
`registrationBypassEmails` is never written onto the public camp document:
both loaders turn it into private per-email documents under
`camps/{year}/private/bypass/emails/`. Keep it empty in committed files; real
extensions are granted from the Camp Year tab.

They were reconstructed from the v1 repository's git history
(`TACL-LYF/lyf-registration`), where every year's dates were commit-by-commit
edits to page literals. Each file's `_source` says which commits, and `_todo`
lists what git could not tell us — mostly fees and caps, which only ever lived
in the Firestore `camps/{year}` documents, and the registration schedule for
2027, which has not been decided yet.

Years before 2024 ran on the legacy registration system; their camp documents
were migrated into Firestore from `camps.csv` (see `migration/`) and are not
in git.

Uses:

- One-time backfill (README, "One-time rollout order" step 2): write each file
  to both databases with
  `CAMP_YEAR=2026 CAMP_YEAR_JSON=camp-years/2026.json ./run.sh -n resetCampYearInfo`
  (set `FIRESTORE_TEST_DATABASE_ID=lyf-v2` for the prod database), or paste
  the values into the Camp Year tab once the function is deployed.
- Emulator seeding: `seed-emulator.sh` loads every file here.
