# Admin runbook

Day-to-day and once-a-year operations for program directors and the tech team:
the admin dashboard, data exports, the camp year rollover and test mode.
File paths in this document are for the tech team; directors can skip them. The
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

Nothing about a camp year is hardcoded in the website. Two kinds of Firestore
documents drive it, and both exist in the production database (`lyf-v2`) and
the test database (`lyf-v2-test`):

- `config/site` points at the years. `currentCampYear` is what the home page
  and `/registration` are for. `preRegistrationCampYear` is what
  `/preregistration` sells, normally the year after.
- `camps/{year}` holds everything about one camp year. The fields are listed
  in the next section.

Both are edited from the admin dashboard's **Camp Year** tab, visible to
`full_admin` and `program_admin`. Every save goes through the
`manageCampYearV2` function, which accepts only the known fields, checks that
the dates are in order and records the change in `adminAuditLog`. Nothing in
these documents is written from the browser directly, and `remainingSpots` is
written only by the registration functions.

Both documents are readable by anyone, signed in or not, so nothing personal
may live in them. That is why the late-registration bypass list is a private
subcollection (see below).

The dashboard and the parent profile page follow `config/site` too. The
dashboard's year picker starts on `currentCampYear` (admins can still pick a
past year), and the profile page splits registrations into current and past
around it. If `config/site` is missing, both fall back to the calendar year
and the dashboard shows a warning.

### What a camp year document holds

| Group                    | Fields                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dates                    | `preRegistrationOpenDate`, `preRegistrationCloseDate`, `earlyRegOpenDate`, `earlyRegEndDate`, `registrationOpenDate`, `registrationLateDate`, `registrationCloseDate`, `infoSessionDate`, `campStartDate`, `campEndDate` | Pacific time. The function refuses a save whose dates are out of order.                                                                                                                                                                                                                                                                              |
| Fees                     | `preRegistrationFee`, `registrationFee`, `registrationLateFee`, `shirtPrice`, `siblingDiscount`                                                                                                                          | In dollars.                                                                                                                                                                                                                                                                                                                                          |
| Capacity                 | `campTotalSizeCap`, `campSizeCaps` (per track), `remainingSpots` (per track)                                                                                                                                             | `remainingSpots` counts down as campers are admitted and may go negative when directors admit over the cap. It is reset to the caps when a year is created from the previous one.                                                                                                                                                                    |
| Name and place           | `name`, `campsite`, `campsiteAddress`                                                                                                                                                                                    | Shown on the registration pages and in emails.                                                                                                                                                                                                                                                                                                       |
| Images                   | `infoSessionImageUrl`, `emailHeaderImageUrl`                                                                                                                                                                             | The banner beside the registration Info step, and the hero image at the top of the registration, waitlist and off-waitlist emails. Must be `https` URLs without embedded credentials (the only kind the site's CSP lets an image load from). Empty means the bundled image.                                                                          |
| Mailchimp audience       | `mailchimpListId`                                                                                                                                                                                                        | The audience that the year's registered and pre-registered parents are added to, tagged `<year>Reg`, `<year>PreReg` and `<year><Track>CampTrack`. The directors create a new audience each year. While it is empty, parents go to the general list and every registration posts a reminder to the error channel.                                     |
| Display toggles          | `showWaitlistHeaderBar`, `showRemainingSpots`, `showWaitlistPosition`                                                                                                                                                    | The waitlist bar above the registration flow, the spots-remaining lines on the Info step, and the waitlist position on the family profile. Missing means off.                                                                                                                                                                                        |
| Late-registration bypass | `camps/{year}/private/bypass/emails/{email}`                                                                                                                                                                             | One document per family allowed to register after `registrationCloseDate`. A parent can read only their own entry, admins can list them, and only `manageCampYear` writes them (the tab's bypass chips). The close date is enforced both by the website and by `createRegistrationSession`, so calling the function directly does not get around it. |

### The yearly cycle

Example: camp 2026 is the current year and camp 2027 is next. Everything
below happens in the Camp Year tab.

**1. During camp 2026, when pre-registration opens**

1. Select 2026 and click **Create next year from selected**. This creates
   `camps/2027` as a copy of 2026 with every date moved forward one calendar
   year and `remainingSpots` reset to the caps.
2. Adjust any dates or fees in the form.
3. Create the 2027 audience in Mailchimp and paste its Audience ID into
   **Mailchimp audience ID**. This is the one field that is not copied from 2026. Until it is set, 2027 parents go to the general list and every
   registration posts a reminder to the error channel.
4. **Save**, then click **Set as pre-registration year**. `/preregistration`
   now sells 2027, opening and closing on 2027's `preRegistrationOpenDate`
   and `preRegistrationCloseDate`.

**2. After camp 2026, before registration for 2027 opens**

1. Select 2027 and click **Set as current camp year**. The home page,
   `/registration` and the Info step now refer to 2027. Registration opens
   for pre-registered families at `earlyRegOpenDate`, for everyone at
   `registrationOpenDate`, and closes at `registrationCloseDate`.
2. Set `infoSessionDate` so the sentence on the Info step is right.
3. Host the new year's banner and email header images (Mailchimp's content
   studio works) and paste their URLs into the **Images** section.
4. Use the **Display toggles** switches for the waitlist header bar, the
   remaining-spots lines and the profile waitlist position. All three have
   been off since 2026.
5. The long notice text on the Info step is the one thing still edited in
   code (`InfoStep.tsx`); ask the tech team for that change.

**3. Late registrations.** Add the family's email to the bypass list on the
current year and **Save**. They can use `/registration` after the close date
without a deploy.

**4. Next year**, repeat from step 1 with 2027 as the source year.

### Rehearsing in test mode

Flip the dashboard's test-data toggle to make the same changes in the test
database. In test mode the tab also offers **Copy … from production** and
**Copy site pointers from production**. They mirror a production camp year
(including its private bypass entries and remaining spots) or the
`config/site` pointers into `lyf-v2-test`; the production database is never
written by these.

Two scripts remain for bootstrapping a database that has nothing yet.
`scripts/src/resetCampYearInfo.ts` writes a `camps/{year}` document in the
test database from a JSON file (the expected shape is in its header comment),
and `scripts/seed-emulator.sh` seeds `config/site` plus two sample camp years
into the emulator.

## Test mode

The dashboard's test-data toggle (and the `isTestData` flag on callable
payloads) routes everything to `lyf-v2-test`, the Stripe test keys and the
test Slack channels, so a full registration or a rollover can be rehearsed
without touching production. Functions have test twins bound to the test
database (`handleTestStripeWebhookV2`, `*OnUpdateTestV2`). Config and data
changes made in test mode stay in `lyf-v2-test`; only the admin roster is
mirrored from production automatically.

## Appendix: first rollout of the config-driven camp year (October 2026)

Kept for the record. This ordered the first deploy of the version in which
camp years became data; a normal release needs none of it. The old deploy
mixed code and data, so the first deploy had to be ordered so that no page
saw a half-migrated state:

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
