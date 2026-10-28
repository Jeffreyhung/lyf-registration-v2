# lyf-registration

This repo contains all of the code for LYF 2023 (and beyond) registration. It's structured into three directories:

1. [functions](functions/): Code for the Firebase Cloud functions
2. [migration](migration/): Code for the migration from the legacy PostGres SQL database into Cloud Firestore
3. [website](website/): Code for the website that displays camper information for each family and the admin dashboard for PDs to manage campers.

# Yarn Workspaces

Followed [this guide](https://semaphoreci.com/blog/typescript-monorepos-with-yarn) to add yarn workspaces support with TypeScript

1. Compile schemas with `yarn workspace schemas build`

## Registration

The camp registration system is a multi-step checkout flow that handles parent/guardian information, camper details, demographics, and payment processing through Stripe. The system supports pre-registration, waitlists, sibling discounts, and camp credit.

### Frontend Architecture

#### RegistrationFlow Component

**Location:** `/website/src/components/Registration/RegistrationFlow.tsx`

The main orchestrator for the entire registration process. It manages:

**Data Loading & Access Control:**

- Loads camp year information and family data (campers, parents, registrations, camp credit)
- Implements time-based access control with early access for pre-registered campers
- Access times come from `camps/{year}` (`earlyRegOpenDate` for pre-registered families, `registrationOpenDate` for everyone) via the `useCampSchedule` hook — see [Camp year rollover](#camp-year-rollover)

**State Management:**

- Uses React Context to provide registration data and dispatch functions throughout the flow
- Implements a reducer pattern (`registrationReducer`) to handle all state changes
- Action types include: AddParent, AddCamper, EditFamily, EditParent, EditCamper, EditDemographics, SetNumOfCampers, SetDonation, LoadFromCache, PrefillParent, PrefillFamily, LoadPendingPaymentRegistrations

**Session Persistence:**

- Saves registration state to browser's localStorage for session recovery
- Detects URL query parameters to handle:
  - `success`: Whether payment succeeded or failed
  - `waitlist`: Whether any campers were waitlisted
  - `continueFromWaitlist`: Resume registration after being moved off waitlist
- Shows a confirmation dialog to continue from previous session
- Validates that the same user and camp year are in the session

**Registration Steps:**
The flow consists of the following sequential steps:

1. **InfoStep** - General camp information and waitlist status
2. **ParentGuardianStep** - Parent/guardian contact information
3. **SelectNumCampersStep** - Choose number of campers to register
4. **CamperStep** (repeated per camper) - Individual camper details (name, birthday, grade, medical info, etc.)
5. **DemographicsStep** (repeated per camper) - Camper demographics (ethnicity, birthplace, language fluency)
6. **ReviewStep** - Review all information and proceed to checkout
7. **ConfirmationScreen** - Final confirmation after successful registration

#### RegistrationDataContext

**Location:** `/website/src/components/Registration/RegistrationDataContext.tsx`

Provides centralized state management for the registration flow:

**Data Structure:**

```typescript
{
  campYear: number,
  family: Family,
  parents: Parent[],
  campers: Camper[],
  demographics: Demographics[],
  donation: number
}
```

**Key Reducer Actions:**

- `AddParent/AddCamper`: Add new parent or camper to the registration
- `EditFamily/EditParent/EditCamper/EditDemographics`: Update specific fields
- `SetNumOfCampers`: Dynamically adjust number of camper/demographic entries
- `SetDonation`: Update donation amount
- `LoadFromCache`: Restore registration state from localStorage
- `PrefillParent/PrefillFamily/PrefillCamper`: Auto-populate fields from database
- `LoadPendingPaymentRegistrations`: Load registrations that were moved off waitlist

All state changes are automatically persisted to localStorage (except ClearData action).

#### ReviewStep Component

**Location:** `/website/src/components/Registration/ReviewStep.tsx`

The final review and checkout step before payment processing:

**Features:**

- Displays summary of all parent, camper, and demographic information
- Shows order summary with pricing breakdown
- Allows optional donation entry
- Validates all required fields before allowing checkout
- Handles navigation back to specific steps for editing

**Checkout Flow:**

1. Validates all required fields are completed
2. Calls `createCheckoutSession()` which invokes the Firebase Cloud Function
3. Handles three possible responses:
   - **Waitlist only**: No payment needed, proceed to confirmation
   - **Covered by camp credit**: No payment needed, proceed to confirmation with optional donation
   - **Payment required**: Redirect to Stripe Checkout

**Error Handling:**

- Shows user-friendly error messages via Snackbar
- Provides fallback contact information (lyf@tacl.org)
- Validates donation input (must be non-negative number)

### Backend Architecture

#### createRegistrationSession Cloud Function

**Location:** `/functions/src/registration/createRegistrationSession.ts`

The main server-side function that processes registration submissions and creates Stripe checkout sessions.

**Request Payload:**

```typescript
{
  campYear: number,
  parents: Parent[],
  campers: Camper[],
  donation: number,
  successUrl: string,
  cancelUrl: string,
  isTestData?: boolean,
  forceWaitlist?: boolean
}
```

**Processing Flow:**

1. **Authentication & Validation**

   - Verifies user is signed in (requires Firebase auth token)
   - Returns 401 error if not authenticated

2. **Camp Data Retrieval**

   - Fetches camp year data from Firestore
   - Gets pricing: `campPrice`, `preRegistrationFee`, `siblingDiscount`
   - Retrieves `remainingSpots` by camp track (YOUNGER/OLDER)

3. **Database Updates** (via `createOrUpdateRegistration`)

   - Creates or updates Family document
   - Creates or updates Parent documents
   - Creates or updates Camper documents
   - Creates or updates Registration documents with appropriate status:
     - `WAITLIST`: If `forceWaitlist` is true OR remaining spots <= 0
     - `PENDING_PAYMENT`: If spots available
   - Determines camp track based on camper's grade
   - Associates all documents via references

4. **Waitlist Handling**

   - Separates campers into `waitlistedCampers` and `registeredCampers`
   - For waitlisted campers:
     - Sends Slack notification to registration channel
     - Sends waitlist email to parent
   - If all campers are waitlisted:
     - Returns early with success (no payment needed)
     - If donation > 0, creates donation-only checkout session

5. **Registration Cost Calculation**

   - Base cost per camper: `campPrice`
   - Subtract pre-registration fee if applicable: `campPrice - preRegistrationFee`
   - Apply sibling discount: `siblingDiscount * (numCampers - 1)`
   - Retrieve and apply camp credit (financial aid)
   - Create Stripe line items for each registered camper

6. **Financial Aid Fast Path**

   - If total cost <= camp credit available:
     - Updates all registrations to `ACTIVE` status
     - Completes registration immediately (via `completeRegistration`)
     - Decrements camp track remaining spots
     - Returns success without Stripe session
     - If donation > 0, creates donation-only checkout session

7. **Stripe Checkout Session Creation**
   - Gets or creates Stripe customer ID for parent
   - Creates line items array:
     - One line item per registered camper
     - Optional donation line item
   - Applies discount coupon if applicable (sibling + camp credit)
   - Metadata attached to each line item:
     ```typescript
     {
       familyRef: string,
       registrationRef: string,
       campYear: string,
       campTrack: string
     }
     ```
   - Configures success/cancel URLs with waitlist flag if needed
   - Returns Stripe session ID for frontend redirect

**Response:**

```typescript
{
  status: "success" | "error",
  code: 200 | 401 | 402,
  sessionId?: string | null,
  isWaitlist?: boolean,
  message?: string
}
```

**Error Handling:**

- Logs errors to Firebase Functions logger
- Sends error notifications to Slack channel
- Returns user-friendly error messages
- Error codes:
  - `401`: Not authenticated
  - `402`: Failed to create Stripe customer or checkout session

#### createOrUpdateRegistration Helper

**Location:** `/functions/src/registration/createOrUpdateRegistration.ts`

Helper function that manages database document creation and updates:

**Operations:**

1. **Family Management**

   - Finds existing family by parent emails or creates new one
   - Merges family data including emails array
   - Returns family document reference

2. **Parent Management**

   - Creates or updates parent documents under family
   - Ensures all parent data is persisted
   - Returns array of parent document references

3. **Camper Management**

   - Creates or updates camper documents under family
   - Stores camper details: name, birthdate, gender, dietary restrictions, medical conditions
   - Embeds demographics information within camper document
   - Returns camper document reference

4. **Registration Management**
   - Finds or creates registration document for camper/camp year pair
   - Determines registration status based on:
     - `forceWaitlist` flag
     - Remaining spots for camp track
     - Existing registration status (respects PENDING_PAYMENT if already set)
   - Stores registration details: grade, shirt size, cabin preference, waiver info
   - Links registration to camper via array union
   - Returns registration reference and status

**Return Value:**

```typescript
{
  familyRef: DocumentReference<Family>,
  parentRefs: DocumentReference<Parent>[],
  camperAndStatuses: Array<{
    camperName: string,
    campTrack: CampTrack,
    isWaitlisted: boolean,
    status: RegistrationStatus,
    registrationRef: DocumentReference<Registration>
  }>
}
```

### Payment Processing Flow

1. **Stripe Checkout Session Creation**

   - User clicks "Checkout" in ReviewStep
   - Frontend calls `createRegistrationSession` Cloud Function
   - Backend creates Stripe session with line items and metadata
   - Returns session ID to frontend

2. **Stripe Checkout Redirect**

   - Frontend redirects user to Stripe-hosted checkout page
   - User enters payment information on Stripe's secure platform
   - Stripe processes payment

3. **Webhook Fulfillment** (handled by separate webhook handler)

   - Stripe sends webhook event on payment success
   - Backend webhook handler:
     - Validates webhook signature
     - Updates registration status to `ACTIVE`
     - Records payment information
     - Decrements remaining spots
     - Sends confirmation email
     - Sends Slack notification

4. **Success Redirect**
   - User redirected back to site with `?success=1` parameter
   - ConfirmationScreen displays success message
   - Registration data cleared from localStorage

### Key Features

**Pre-Registration:**

- Early registrants pay a deposit (pre-registration fee)
- Can register earlier than general registration
- Receive discount on final registration cost

**Waitlist System:**

- Automatic waitlist placement when camp track is full
- Email notifications sent to parents
- Ability to continue registration if moved off waitlist via `continueFromWaitlist` URL param
- Separate processing for waitlisted vs. registered campers

**Discounts & Credits:**

- **Sibling Discount**: Applied per additional camper in same family
- **Camp Credit**: Financial aid applied automatically, can cover full cost
- Discounts calculated server-side (not trusted from client)
- Combined into single Stripe discount coupon

**Session Management:**

- Auto-save to localStorage on every state change
- Resume capability for incomplete registrations
- User/camp year validation prevents cross-contamination
- Query parameter handling for various flow states

**Data Validation:**

- Client-side validation of required fields
- Server-side authentication checks
- Schema validation via `lyf-registration-schemas` package
- Error handling with user-friendly messages


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

### One-time rollout order

The old deploy mixed code and data; the first deploy of this version has to
be ordered so no page sees a half-migrated state:

1. **Firestore rules** — `yarn deploy:firestore`. `camps/{year}` and `config/`
   become public-read / server-write (the old site keeps working: it only read
   `camps/{year}` while signed in).
2. **Backfill data** in *both* `lyf-v2` and `lyf-v2-test`: create
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

### Testing

The system supports test mode via the `isTestData` flag which:

- Uses test Firestore database
- Uses Stripe test mode
- Sends notifications to test Slack channels
- Allows testing without affecting production data

# Deployment

Everything deploys from GitHub Actions on merge to `main`. Pull requests only run
CI (`ci.yml`, `test-firestore-rules.yml`); nothing is deployed from a PR.

| Workflow                                                     | Deploys                                                    | Triggered by                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [deploy-website.yml](.github/workflows/deploy-website.yml)   | Gatsby site → GitHub Pages                                 | every push to `main`                                                                 |
| [deploy-firebase.yml](.github/workflows/deploy-firebase.yml) | Cloud Functions (`v2` codebase), Firestore rules + indexes | pushes to `main` that touch `functions/`, `schemas/`, `firestore.*`, `firebase.json` |

Both can also be run by hand from the Actions tab (`workflow_dispatch`). The
Firebase workflow only deploys the parts whose files changed; the manual run
has checkboxes to pick functions and/or Firestore.

## GitHub Pages

Repository **Settings → Pages → Source** must be set to _GitHub Actions_. The
build reads the `GATSBY_FIREBASE_*` secrets listed in the workflow and the
optional `GATSBY_CUSTOM_DOMAIN` repository variable (set it to serve from a
custom domain at the site root; leave it unset to serve from
`<owner>.github.io/<repo>` with prefixed asset paths).

## Firebase (Workload Identity Federation)

The Firebase workflow authenticates to Google Cloud with
[Workload Identity Federation](https://github.com/google-github-actions/auth#indirect-wif),
so no service-account key is stored in GitHub. One-time setup, run with an
account that is Owner on the Firebase project:

```bash
PROJECT_ID=lyf-registration            # Firebase/GCP project id
REPO=OWNER/REPO                        # GitHub repository, e.g. TACL-LYF/lyf-registration-v2
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# 1. Deployer service account
gcloud iam service-accounts create github-deployer \
  --project="$PROJECT_ID" --display-name="GitHub Actions deployer"
SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# 2. Roles needed by `firebase deploy --only functions,firestore`
for role in roles/firebase.admin roles/cloudfunctions.developer roles/run.admin \
            roles/iam.serviceAccountUser roles/artifactregistry.writer \
            roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role"
done

# 3. Workload identity pool + GitHub OIDC provider, restricted to this repo
gcloud iam workload-identity-pools create github --project="$PROJECT_ID" --location=global
gcloud iam workload-identity-pools providers create-oidc github-actions \
  --project="$PROJECT_ID" --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${REPO}'"

# 4. Let identities from that pool/repo impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"

# 5. Values for the GitHub repository variables below
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-actions"
echo "GCP_SERVICE_ACCOUNT=$SA"
```

Then in the GitHub repository, **Settings → Secrets and variables → Actions**:

**Variables**

| Name                                                                | Value                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`                                    | printed by step 5                                                                                                     |
| `GCP_SERVICE_ACCOUNT`                                               | printed by step 5                                                                                                     |
| `FIREBASE_PROJECT_ID`                                               | Firebase/GCP project id to deploy to, e.g. `lyf-registration`                                                         |
| `GATSBY_FIRESTORE_DATABASE_ID`, `GATSBY_FIRESTORE_TEST_DATABASE_ID` | named Firestore databases (`lyf-v2`, `lyf-v2-test`); shared with the website build so both sides target the same data |
| `ALLOWED_REDIRECT_ORIGINS`                                          | comma-separated origins Stripe may redirect back to after checkout                                                    |

**Secrets** – the functions' runtime environment. The workflow writes these to
`functions/.env` before deploying, which is what the Firebase CLI applies to
the deployed functions, so it refuses to deploy if any is empty (an empty value
would overwrite the live configuration). The names match `functions/.env.example`:

- Stripe: `STRIPE_API_KEY`, `STRIPE_TEST_API_KEY`, `STRIPE_ENDPOINT_SECRET`, `STRIPE_TEST_ENDPOINT_SECRET`
- Registration email: `EMAIL`, `EMAIL_CLIENT_ID`, `EMAIL_CLIENT_SECRET`, `EMAIL_REFRESH_TOKEN`
- Firebase web config: `GATSBY_FIREBASE_API_KEY`, `GATSBY_FIREBASE_AUTH_DOMAIN`, `GATSBY_FIREBASE_PROJECT_ID`, `GATSBY_FIREBASE_STORAGE_BUCKET`, `GATSBY_FIREBASE_MESSAGING_SENDER_ID`, `GATSBY_FIREBASE_APP_ID` (and optional `GATSBY_FIREBASE_MEASUREMENT_ID`)
- Mailchimp: `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER`
- Slack: `SLACK_REGISTRATION_WEBHOOK`, `SLACK_REGISTRATION_FOR_CAMP_WEBHOOK`, `SLACK_ERROR_WEBHOOK`

The deploy jobs run in a GitHub environment named `firebase`. It is created
automatically on the first run; add required reviewers to it under
**Settings → Environments** if production deploys should need an approval, and
secrets can be scoped to it instead of the repository.
