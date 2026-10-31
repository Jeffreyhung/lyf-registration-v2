# Admin runbook

Day-to-day and once-a-year operations for program directors and the tech team:
the admin dashboard, data exports, the camp year rollover and test mode. The
registration flow itself is described in
[architecture-registration.md](architecture-registration.md); deploying is in
[deployment.md](deployment.md).

## Admin dashboard

The admin dashboard lives at `/admin` on the website. Its **All Registrations**
grid (`website/src/components/Admin/RegistrationDashboard.tsx`) lists every
registration for the selected camp year joined with the camper, the parents and
the family document (`website/src/hooks/useRegistrations.tsx`). Health columns
appear only for roles with the `readHealth` capability.

### Exports

Data exports come from the All Registrations grid; there are no longer any
Admin SDK scripts for them. The grid toolbar's **Export** menu has two halves.

**One-click exports (all registrations).** Each item downloads a ready-made
CSV built from every registration for the selected camp year, ignoring the
grid's filters. They replace the retired scripts one for one. Files are named
`<camp year>-lyf-<export>-<YYYY-MM-DD>.csv`.

| Menu item                           | Contents                                                                                                                                        | Replaced script            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Active camper mailing addresses     | One row per Active registration: camper, parent names, street, suite, city, state, zip, country.                                                | `getCamperAddress`         |
| Active parent emails                | Deduplicated parent and family-account emails for Active registrations, with names where known.                                                 | `getActiveRegEmails`       |
| Pre-registered parent emails        | Same, for every registration flagged as pre-registered (any status).                                                                            | `getPreRegEmails`          |
| Pre-registered campers              | Pre-registered campers with status, grade and parent emails.                                                                                    | `getPreRegCampers`         |
| Active camper info                  | Names, birthday, grade, gender, pronouns, shirt size, flags, notes and, for roles with `readHealth`, the health fields.                         | `getActiveCamperInfo`      |
| Parent emails for specific campers… | Opens a dialog: paste camper names one per line, get their parents' emails and family-account emails. Names that match nothing are listed back. | `getParentEmailsForCamper` |

The definitions live in `website/src/components/Admin/registrationExports.ts`;
adding an export is adding an entry to `QUICK_EXPORTS`.

**This grid (filtered rows).** _CSV (visible columns)_, _CSV (all columns)_ and
_Print_ export what the grid currently shows. They honour the status filter
above the grid, the toolbar's filter panel and the search box, across all
pages; if any rows are checked, only those rows are exported. Address
(street, suite, city, state, zip, country), household-culture and
family-account-email columns are hidden by default to keep the grid readable.
Turn them on from **Columns**, or use _CSV (all columns)_, which includes
hidden columns. The **?** button next to Export summarises all of this.

The two copy-to-clipboard buttons above the grid (parent emails; parent email,
first and last name tab-separated) stay as quick paths for the rows that match
the current status filter.

## Camp year rollover

Nothing about a camp year is hardcoded in the website any more. Two kinds of
Firestore documents drive it, in both the prod (`lyf-v2`) and test
(`lyf-v2-test`) databases:

- `config/site` — `currentCampYear` (what the registration page and home page
  are for) and `preRegistrationCampYear` (what the pre-registration page
  sells, normally `currentCampYear + 1`). Public read, never written from the
  client.
- `camps/{year}` — dates (`preRegistrationOpenDate`, `preRegistrationCloseDate`,
  `earlyRegOpenDate`, `earlyRegEndDate`, `registrationOpenDate`,
  `registrationLateDate`, `registrationCloseDate`, `infoSessionDate`,
  `campStartDate`, `campEndDate`), fees, caps, campsite, the per-year images
  (`infoSessionImageUrl` for the banner beside the registration Info step,
  `emailHeaderImageUrl` for the hero image at the top of the registration,
  waitlist and off-waitlist emails; both must be https URLs without embedded
  credentials, the only kind the site's CSP lets an image load from, and
  both fall back to the bundled images when empty) and the display toggles (`showWaitlistHeaderBar`,
  `showRemainingSpots`, `showWaitlistPosition`; missing means off). Public
  read, so nothing personal may live here; configuration fields are written
  only by the `manageCampYear` function, and `remainingSpots` only by the
  registration functions.
- `camps/{year}/private/bypass/emails/{email}` — one document per family
  allowed to register after `registrationCloseDate`. A parent can read only
  their own entry (so the list cannot be enumerated), admins can list them,
  and only `manageCampYear` writes them. The Camp Year tab's bypass chips
  edit this collection. The close date is enforced in two places: the
  website hides the page, and `createRegistrationSession` refuses to create
  a registration after the close unless the caller has an entry, so calling
  the function directly does not get around it.

The admin dashboard (`/admin`) and the parent profile page (`/user/profile`)
also follow `config/site`: the dashboard's year picker starts on
`currentCampYear` (admins can still pick a past year), and the profile page
splits registrations into current and past around it. Both fall back to the
calendar year, with a warning on the dashboard, only if `config/site` is
missing.

Both are edited from the admin dashboard's **Camp Year** tab, visible to
`full_admin` and `program_admin` (the `manageCampYear` capability). Every
write goes through the `manageCampYearV2` callable, which enforces the key
whitelist, checks date ordering and appends to `adminAuditLog`.

### The yearly cycle (dashboard steps)

Example: camp 2026 is the current year and camp 2027 is next.

1. **During camp 2026 (pre-registration opens):** in the Camp Year tab select
   2026 and click **Create next year from selected**. This creates
   `camps/2027` as a copy of 2026 with every date moved forward one calendar
   year (Pacific time) and `remainingSpots` reset to the caps. Adjust any dates
   or fees in the form and **Save**. Then click **Set as pre-registration
   year** so `/preregistration` sells 2027 — it opens and closes on 2027's
   `preRegistrationOpenDate` / `preRegistrationCloseDate`.
2. **After camp 2026 (registration for 2027 approaches):** select 2027 and
   click **Set as current camp year**. The home page, `/registration` and the
   info step now refer to 2027; registration opens for pre-registered families
   at `earlyRegOpenDate`, for everyone at `registrationOpenDate`, and closes at
   `registrationCloseDate`. Set `infoSessionDate` so the InfoStep sentence is
   right, paste the new year's banner and email header image URLs into the
   **Images** section (host them first, e.g. in Mailchimp's content studio),
   and use the **Display toggles** switches for the waitlist header bar,
   remaining-spots lines and profile waitlist position (all off since 2026).
   Only the long notice copy in `InfoStep.tsx` is still edited in code.
3. **Late registrations:** add the family's email to the bypass list on the
   current year and **Save** — they can use `/registration` after the close
   date without a deploy.
4. Repeat from step 1 with 2027 as the source year.

Flip the dashboard's test-data toggle to make the same changes in the test
database. In test mode the tab also offers **Copy … from production** and
**Copy site pointers from production**, which mirror a production camp year
(including its private bypass entries and remaining spots) or the
`config/site` pointers into `lyf-v2-test`; the production database is never
written by these. Scripts remain for bootstrapping: `scripts/src/resetCampYearInfo.ts`
writes a `camps/{year}` document in the test database from a JSON file (the
expected shape is in its header comment), and `scripts/seed-emulator.sh`
seeds `config/site` plus two sample camp years into the emulator.

### One-time rollout order (historical)

Kept for the record: this ordered the first deploy of the config-driven camp
year (October 2026). A normal release needs none of it.

The old deploy mixed code and data; the first deploy of this version has to
be ordered so no page sees a half-migrated state:

1. **Firestore rules** — `yarn deploy:firestore`. `camps/{year}` and `config/`
   become public-read / server-write (the old site keeps working: it only read
   `camps/{year}` while signed in).
2. **Backfill data** in _both_ `lyf-v2` and `lyf-v2-test`: create
   `config/site` with `currentCampYear: 2026` and `preRegistrationCampYear:
2027`; add the new fields to `camps/2026` (`preRegistrationOpenDate`,
   `preRegistrationCloseDate`, `infoSessionDate`, `registrationBypassEmails`)
   and create/complete `camps/2027` with the same set, using the dates
   that were hardcoded in the previous release as the source of truth.
   Until the callable is deployed, write them with `resetCampYearInfo`
   (Admin SDK) or the Firebase console; afterwards the Camp Year tab is the
   only path needed.
3. **Functions** — `yarn deploy:functions` deploys `manageCampYearV2`.
4. **Website** — deploy the site. With the data in place the pages resolve
   their schedule; if `config/site` or a camp document is missing they fail
   closed with a "not available right now" message rather than a stale date.
5. **Grant `program_admin`** to the program directors who will run the
   rollover, via the Admin Management tab (or `grantAdminAccess` with
   `ADMIN_ROLE=program_admin` for the very first one).

## Test mode

The dashboard's test-data toggle (and the `isTestData` flag on callable
payloads) routes everything to `lyf-v2-test`, the Stripe test keys and the
test Slack channels, so a full registration or a rollover can be rehearsed
without touching production. Functions have test twins bound to the test
database (`handleTestStripeWebhookV2`, `*OnUpdateTestV2`). Config and data
changes made in test mode stay in `lyf-v2-test`; only the admin roster is
mirrored from production automatically.
