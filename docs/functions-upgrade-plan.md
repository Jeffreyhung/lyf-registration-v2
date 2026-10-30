# Cloud Functions upgrade plan

A ready-to-execute checklist for bringing `functions/` from firebase-functions 5 /
firebase-admin 12 / stripe 14 to the current majors. Written 2026-10-30 against
`functions/package.json` at that date; re-check the "latest" column before
starting (versions move monthly).

Everything in `functions/src` that each upgrade touches is listed with the exact
edit, so a step can be done in one sitting and verified with the usual three
commands:

```bash
yarn workspace functions lint
yarn workspace functions test
yarn --cwd functions tsc --noEmit -p tsconfig.json
```

The sandboxed review session that wrote this could not download packages, so
nothing below has been compiled against the new versions. Where a type is
expected to change the plan says "verify with tsc".

## 0. Already done (PR "functions runtime: dependency cleanup")

- `firebase-tools` and `mjml` moved to `devDependencies`; `@slack/client`,
  `dotenv`, `global`, `md5`, `really-relaxed-json`, `@types/md5`, `@types/mjml*`
  removed. Slack posts use `fetch`, the Mailchimp subscriber hash uses
  `crypto`, MJML is compiled at build time (`yarn build:templates`).
- `setGlobalOptions({region: "us-west2"})` replaces `SUPPORTED_REGIONS[3]`
  (that export is v1-only and disappears from the package root in
  firebase-functions 6).
- `engines.node` is `"22"`, matching `runtime: nodejs22` in `firebase.json` and
  the new root `.nvmrc`.
- **Still to do by hand:** run `yarn install` at the repo root and commit the
  updated `yarn.lock` (the sandbox could not reach the registry). CI runs
  `yarn install --frozen-lockfile`, so the cleanup PR stays red until then.

## 1. Version table

| Package | In `package.json` | Installed | Latest (2026-10-30) | Node floor | Notes |
| --- | --- | --- | --- | --- | --- |
| firebase-functions | ^5.0.1 | 5.1.1 | 7.4.0 | >=18 | peer `firebase-admin ^11.10 \|\| ^12 \|\| ^13 \|\| ^14`; depends on express ^5.2 |
| firebase-admin | ^12.2.0 | 12.7.0 | 14.5.0 | >=22 | 13.x floor is Node 18 if 22 is a problem locally |
| stripe | ^14.8.0 | 14.25.0 | 23.1.0 | >=20 | pins API `2026-10-28.endive`; `apiVersion` is typed as that literal |
| firebase-tools (dev) | ^13.11.4 | 13.35.1 | 15.34.2 | >=20 | emulators need Java 21 from 15.0 |
| firebase-functions-test (dev) | 3.3.0 | 3.3.0 | check | | not imported anywhere; peer range stops at admin 12 |
| typescript (dev) | ~5.8.3 | 5.8.3 | | | firebase-functions 7 targets ES2022, same as `functions/tsconfig.json` |
| express (transitive) | | 4.22.1 | 5.x via functions 7 | | only `Response` is imported, see 2.3 |

## 2. firebase-functions 5 → 7 (with firebase-admin 12 → 14 and firebase-tools 13 → 15)

Do these three together: functions 7 wants admin ≥ 11.10 and a CLI that knows
the SDK, and nothing in this codebase is affected by admin 13/14 on its own.

### 2.1 Breaking changes that matter here

firebase-functions

- 6.0.0: the package root (`import ... from "firebase-functions"`) is the **v2**
  API. v1 moved to `firebase-functions/v1`. We only import `logger` from the
  root, which v2 also exports, so no change; `SUPPORTED_REGIONS` was the one
  v1-only import and is already gone.
- 7.0.0: Node 16 dropped (we run 22); `functions.config()` removed (not used,
  all configuration comes from `.env`); compiled for ES2022 with TypeScript 5
  (matches ours); the emulator now answers 500 to an unhandled error in an
  async `onRequest` (our `withSentryRequest` already does this); v1 `Event`
  renamed `LegacyEvent` (v1 not used).
- 7.x depends on express 5. `firebase-functions/v2/https` re-exports the
  express `Response` type since 7.4.0.

firebase-admin

- 13.0.0: Node 18+, deprecated FCM APIs removed, credentials via
  google-auth-library. None used here.
- 14.0.0: Node 22+, legacy namespace (`admin.firestore()` style) removed,
  Instance ID removed, FCM legacy types removed. This codebase only uses the
  modular entry points (`firebase-admin/app`, `firebase-admin/firestore`),
  `getFirestore(databaseId)`, `FieldValue`, `Timestamp`, `DocumentReference`.
  `@google-cloud/firestore` moves to 9.x: `DocumentReference<T>` still works
  (the second generic defaults to `DocumentData`).
- `scripts/` pins its own `firebase-admin ^11`; leave it, it is not deployed.

firebase-tools

- 14.0.0: Node 18 dropped; `experimental:functions:shell` removed (we use
  `functions:shell`).
- 15.0.0: emulators require Java 21 (`.github/workflows/test-firestore-rules.yml`
  must set up Java 21); function timeouts are strictly validated (we set none);
  `--open-sesame` flags removed (not used).

### 2.2 Checklist

1. Branch from `main`. In `functions/package.json` set
   `"firebase-functions": "^7.4.0"`, `"firebase-admin": "^14.5.0"`,
   `"firebase-tools": "^15.34.2"` (devDependencies). Remove
   `firebase-functions-test` unless a test has started using it; if kept, bump
   to a release whose peer range includes admin 14.
2. `yarn install` at the repo root; commit `yarn.lock`.
3. `functions/src/stripe/handleStripeWebhook.ts` and
   `functions/src/utils/sentry.ts`: replace `import {Response} from "express"`
   with `import type {Response} from "firebase-functions/v2/https"` so the
   type always matches the express major the SDK ships. (`Request` already
   comes from there.)
4. Run the three commands. Expected to be clean; if `tsc` complains about
   `DocumentReference<X>` casts in `fullfillRegistration.ts` /
   `releaseRegistrationHolds.ts` / `moveCampersOffWaitlist.ts`, change the cast
   to `DocumentReference<X, DocumentData>`.
5. `yarn build` then `yarn --cwd functions run isolate` and open
   `functions/isolate/package.json`: only runtime packages, no `firebase-tools`,
   no `mjml`.
6. Emulator smoke test (needs Java 21 and local port binding, so outside the
   sandbox): `yarn emulators`, then `functions/test/run.sh`. Check every
   function is listed by the emulator UI; the two Firestore triggers must bind
   to the `lyf-v2`/`lyf-v2-test` databases (the CLI reads
   `FIRESTORE_DATABASE_ID` / `FIRESTORE_TEST_DATABASE_ID` from `.env`).
7. `.github/workflows/test-firestore-rules.yml` already sets up Java 21; switch
   its `npx firebase-tools emulators:exec` to `yarn firebase emulators:exec`
   so CI runs the locked CLI version instead of whatever npx resolves.
8. Merge; `deploy-firebase.yml` deploys on push. Watch the deploy log for the
   SDK version banner and for each function's revision, then run one
   `isTestData` registration from the website against the test database and
   confirm the Stripe test webhook (`handleTestStripeWebhookV2`) fulfils it.
9. Rollback: `git revert` and push; functions redeploy from the previous
   sources. There is no state migration in this step.

Risk: low. The code already uses the v2 API surface exclusively; the only
compile-time exposure is the express types.

## 3. stripe 14 → 23 (API 2023-10-16 → 2026-10-28.endive)

### 3.1 Every Stripe surface this code touches

| Call / field | Where | Status in 2026-10-28.endive |
| --- | --- | --- |
| `new Stripe(key, {apiVersion})` | `utils.ts` | `apiVersion` must be the SDK's own version string (typed as `LatestApiVersion`) |
| `stripe.webhooks.constructEvent(rawBody, sig, secret)` | `handleStripeWebhook.ts` | unchanged (snapshot events). 21.x throws if a thin-event parser is used on a snapshot payload, which we never do |
| `event.id`, `event.type`, `event.data.object` | `handleStripeWebhook.ts` | unchanged |
| events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` | `handleStripeWebhook.ts` | unchanged; `checkout.session.async_payment_failed` is still unhandled (see security review) |
| `checkout.sessions.retrieve(id, {expand: ["line_items.data.price.product", "payment_intent.payment_method"]})` | `handleStripeWebhook.ts`, `issueStripeRefund.ts` | unchanged |
| `checkout.sessions.create({line_items[].price_data{currency, product_data{name, metadata}, unit_amount}, mode, metadata, success_url, cancel_url, customer, payment_intent_data.description, discounts[{coupon}], expires_at})` | `createStripeCheckoutSession.ts` | unchanged. `payment_method_types` was removed from this call in endive; it only appears here as a comment, delete the comment |
| `Session.id/metadata/amount_total/customer_email/customer_details.{email,name}/payment_status/payment_intent/customer/line_items/total_details.amount_discount` | `fullfillRegistration.ts`, `fulfillPreRegistrations.ts`, `releaseRegistrationHolds.ts`, `handleStripeWebhook.ts` | unchanged types (`metadata: Metadata \| null`, `customer_details.email: string \| null`, ...), all already read with `?.`/`??` |
| `LineItem.description`, `.amount_total`, `.amount_subtotal`, `.price.product` (expanded `Product.metadata`) | `fullfillRegistration.ts`, `fulfillPreRegistrations.ts`, `releaseRegistrationHolds.ts` | **`description` is `string \| null` since 2024-09-30.acacia** (was `string`). Four `item.description.includes(...)` calls stop compiling |
| `PaymentIntent.id`, `.payment_method` (expanded `PaymentMethod.type`) | both fulfil paths | unchanged |
| `customers.create({name, email})` | `getStripeCustomerId.ts` | unchanged. (The singular `coupon`/`promotion_code` params were removed from Customer create in basil; we never passed them) |
| `coupons.create({amount_off, currency, name, duration: "once"})` | `createStripeCheckoutSession.ts` | unchanged. basil removed `amount_off` + `duration: "forever"` coupons (reinstated in 2026-01-28.clover); `once` was never affected |
| `refunds.create({amount, payment_intent})` | `issueStripeRefund.ts` | unchanged |
| `Stripe.Metadata` (type of `LineItem.metadata`) | `createStripeCheckoutSession.ts`, `createRegistrationSession.ts`, `createPreRegistrationSession.ts` | still `{[name: string]: string}` in `shared.d.ts`; verify with tsc that the `Stripe.Metadata` namespace path resolves after the v22 typings refactor (else `import type {Metadata} from "stripe"` equivalents) |

API-version changes between the pin and endive that were checked and do **not**
touch this code: 2024-04-10 (PaymentIntents default to `automatic_async`
capture, see 3.3), 2024-06-20 (Issuing/Connect), acacia (billing alerts,
Terminal consent), basil (shipping_details, subscription Checkout semantics,
invoice/subscription remodel, `total_count` expansion), clover
(`Discount.coupon` → `Discount.source`, `currency_conversion`), dahlia (Checkout
`ui_mode` enum values, Stripe.js renames), endive (`payment_method_types`
removal, tax calculation errors).

### 3.2 SDK breaking changes 15 → 23 that matter here

- 17.0.0: automatic network retries and backoff defaults were raised. Set them
  explicitly (see checklist) so a Stripe stall cannot eat the function's 60 s.
- 21.0.0: `decimal_string` fields became `Stripe.Decimal` (none read here);
  wrong webhook parsing method throws (we use `constructEvent` correctly).
- 22.0.0: `Stripe` is an ES6 class and the CJS entry no longer has `.default`
  (our `import Stripe from "stripe"` with `esModuleInterop` is the documented
  form); callbacks removed (we use `await`); request options must come after
  params (we pass params only); `types/` directory removed (we have no
  `/// <reference types="stripe/types">`).
- 23.0.0: Node 18 dropped; `constructEventWithoutVerification` removed (not
  used); `verifyHeader` tolerance defaults changed (we rely on the default).

### 3.3 Checklist

1. In the Stripe Dashboard → Developers → Workbench note the **account** API
   version and the API version of the two v2 webhook endpoints
   (`handleStripeWebhookV2`, `handleTestStripeWebhookV2`). v1
   (`TACL-LYF/lyf-registration` on Netlify) shares this account, so do **not**
   upgrade the account default while v1 is live; the SDK pin below is enough
   for v2's own requests.
2. `functions/package.json`: `"stripe": "^23.1.0"`; `yarn install`; commit the
   lockfile.
3. `functions/src/utils.ts`: both clients become

   ```ts
   const STRIPE_OPTIONS = {
     apiVersion: "2026-10-28.endive", // must equal the SDK's pinned version
     maxNetworkRetries: 2,
     timeout: 20_000, // ms; the default 80 s outlives a 60 s function
   } as const satisfies Stripe.StripeConfig;
   export const stripe = new Stripe(process.env.STRIPE_API_KEY as string, STRIPE_OPTIONS);
   export const testStripe = new Stripe(process.env.STRIPE_TEST_API_KEY as string, STRIPE_OPTIONS);
   ```

   `tsc` is the check that the literal matches: `apiVersion` is typed as the
   SDK's exact version.
4. `LineItem.description` is nullable. In `fullfillRegistration.ts` (two
   `.includes("Donation")` / `.includes("Registration")` filters and
   `registrationDescriptions.push(item.description)`) and
   `fulfillPreRegistrations.ts` (same two filters and
   `item.description` in the Slack message / payment items) read it as
   `item.description ?? ""`. Consider matching on `product.metadata` (the
   registration line items carry `registrationRef`) instead of the description
   text while there; that is a behaviour change, so keep it to a follow-up PR.
5. Delete the `// payment_method_types: [...]` comment in
   `createStripeCheckoutSession.ts`.
6. Run the three commands. Type errors to expect only if a namespace path
   moved: `Stripe.Checkout.Session`, `Stripe.Checkout.SessionCreateParams.Discount`,
   `Stripe.Event`, `Stripe.Product`, `Stripe.PaymentIntent`,
   `Stripe.PaymentMethod`, `Stripe.Metadata`. All exist in 23.1.0's
   `cjs/resources/**` declarations; fix imports rather than casting.
7. Unit tests: `test/unit/createStripeCheckoutSession.test.ts` and
   `getStripeCustomerId.test.ts` mock the client, so they pass regardless; add
   one assertion that `stripe`/`testStripe` were constructed with
   `apiVersion: "2026-10-28.endive"` in `utils.test.ts` (the Stripe constructor
   is already mocked there).
8. Test mode end to end before merging, from a local build with
   `STRIPE_TEST_*` keys: `stripe listen --forward-to localhost:5001/<project>/us-west2/handleTestStripeWebhookV2`,
   then an `isTestData` registration with a sibling discount and a donation
   (exercises `coupons.create`, `discounts`, `expires_at`, both fulfil paths) and
   an expired session (`stripe trigger checkout.session.expired` will not carry
   our metadata; instead create a session with a 30-minute `expires_at` and
   wait, or temporarily lower `REGISTRATION_CHECKOUT_EXPIRY_MINUTES`).
9. Merge and deploy. Then, in the Dashboard, set the API version of the two v2
   webhook endpoints to `2026-10-28.endive`. The handler re-fetches the session
   through the SDK, so the event payload version only has to carry
   `data.object.id`; this step is for consistency, not correctness.
10. Admin refund check after deploy: issue a small test-mode refund from the
    dashboard (`issueStripeRefundV2`). Note 2024-04-10 made `automatic_async`
    the default capture: a refund requested in the seconds after a payment
    completes can be rejected until capture settles. Admin refunds happen
    hours later, so no code change, but the error path (Slack + Sentry) is
    the right behaviour if it ever happens.
11. Rollback: revert the PR; the API version is per request (header), so
    nothing on the Stripe side needs undoing except the webhook endpoint
    version if step 9 was done.

Risk: medium only because of volume of releases crossed; the surface used is
small and stable. The one certain compile break is `LineItem.description`.

## 4. Runtime options (decision needed, not an upgrade)

2nd gen defaults apply to every function today: 256 MiB, 1 vCPU, concurrency
80, 60 s timeout, no minimum instances. With `mjml` gone from the bundle the
memory headroom is better, but two changes are still worth a decision:

- `createRegistrationSession` and the two webhooks do Firestore transactions,
  Stripe calls, SMTP and Mailchimp in one request. Setting
  `memory: "512MiB"` and `timeoutSeconds: 120` on `callableOptions` /
  `webhookOptions` (`src/utils/auth.ts`, `src/stripe/handleStripeWebhook.ts`)
  costs little at this volume and removes the two ways a slow SMTP handshake
  currently fails a payment fulfilment.
- `minInstances: 1` on `createRegistrationSession` for the registration window
  (set in `manageCampYear` dates, so it could be toggled by a deploy when
  registration opens) removes the cold start from the first family in the
  door. It is billed as idle time for the whole month; compare against the
  Cloud Run pricing page before enabling.
- Firestore over REST: `db.settings({preferRest: true})` right after
  `getFirestore(...)` in `utils.ts` skips the gRPC channel setup on cold start.
  Supported by `@google-cloud/firestore` ≥ 6.5 for everything these functions
  do (no listeners). Try it in the emulator first.

## 5. Dependencies to leave alone (checked)

- `date-fns` / `date-fns-tz`: used for `formatInTimeZone(..., "EEEE MMM do, Y")`
  (ordinal day, which `Intl` cannot format directly) and for the DST-correct
  year shift in `campYearConfig.ts`. Both load in about a millisecond; an
  `Intl` rewrite would be more code for no runtime gain.
- `mustache`: 4 KB, no dependencies, still rendering at send time.
- `nodemailer` 6.10: works; 7.x exists and is a drop-in for the SMTP/OAuth2
  usage here, upgrade opportunistically.
- `mjml` 4.18 (now build-only): its `html-minifier` dependency has an open
  ReDoS advisory, which is why keeping it out of the runtime bundle mattered;
  move to `@mjml/*` 5 when it is stable.
