# Registration architecture

How a family gets from the registration page to a paid, active registration,
and which invariants the code defends on the way. The admin side (dashboard,
exports, camp year rollover) is in [admin-runbook.md](admin-runbook.md).

```
website/src/components/Registration/*        functions/src/registration/*            Stripe
─────────────────────────────────────        ────────────────────────────            ──────
RegistrationFlow (steps, localStorage)
  └─ ReviewStep ── callable ──────────────▶ createRegistrationSession
                                             ├─ createOrUpdateRegistration (one transaction:
                                             │    family/parents/campers/registrations +
                                             │    admission decision + remainingSpots)
                                             ├─ all waitlisted → return (no payment)
                                             ├─ fully covered by camp credit → completeRegistration
                                             └─ otherwise createStripeCheckoutSession ──▶ Checkout
  ◀── redirect ?success=1[&waitlist=1] ─────────────────────────────────────────────────┘
                                           handleStripeWebhook ◀── checkout.session.completed
                                             └─ fulfillRegistration → payment doc, ACTIVE,
                                                completeRegistration (email, Slack, spots, credit)
                                           handleStripeWebhook ◀── checkout.session.expired
                                             └─ releaseRegistrationHolds (spots back)
```

Everything below is per camp year; prices, dates and caps come from
`camps/{year}` ([admin-runbook.md](admin-runbook.md#camp-year-rollover)), and
the `isTestData` flag routes the whole flow to `lyf-v2-test` and Stripe test
mode.

## Website

`RegistrationFlow.tsx` owns the multi-step form and a reducer
(`RegistrationDataContext.tsx`) whose state is mirrored to `localStorage` on
every change, together with the step reached, keyed by signed-in user and camp
year, so a family can resume where they left off: a dialog describes the saved
session and "Continue" restores both the data and the step. It is only offered
for a visit that got past the Info step, since the automatic prefill from the
server already writes the cache. Steps:
Info → Parent/Guardian → number of campers → one Camper step and one
Demographics step per camper → Family culture → Review → Confirmation.

- **Opening times** come from `useCampSchedule`: `earlyRegOpenDate` for
  families with a pre-registration, `registrationOpenDate` for everyone,
  closing at `registrationCloseDate` unless the family is on the bypass list.
- **Query parameters** steer the flow after a redirect: `success=1` shows the
  confirmation and clears the cache, `waitlist=1` tells the confirmation that
  some campers were waitlisted, `continueFromWaitlist` reloads the campers'
  existing registrations so a family moved off the waitlist can pay.
- `ReviewStep.tsx` is the only place that calls the backend. It validates
  required fields client-side, then calls `FUNCTION_NAMES.createRegistrationSession`
  and acts on the response: `sessionId` → `stripe.redirectToCheckout`;
  success without a session → confirmation screen (all waitlisted, or fully
  covered by camp credit); error → snackbar with the lyf@tacl.org fallback.
  Nothing about price or discounts is trusted from the client.

## Backend architecture

### createRegistrationSession (callable)

`functions/src/registration/createRegistrationSession.ts`. Deployed as
`createRegistrationSessionV2`.

1. **Guards.** Signed-in caller required. The payload is parsed with
   `validateRegistrationPayload` (strips Firestore leftovers, bounds and
   enums); redirect URLs must match `ALLOWED_REDIRECT_ORIGINS`; a donation is
   capped. `isTestData` and `forceWaitlist` are resolved against the caller's
   role, not taken at face value. The camp year must exist and have a positive
   price (otherwise a $0 registration would be "fully covered" and activated
   for free), and `assertRegistrationOpen` re-applies the close date and the
   bypass list because the callable is reachable without the website.
2. **Writes + admission in one transaction** (`createOrUpdateRegistration.ts`).
   Finds or creates the family by parent emails (first writer becomes
   `createdBy`), upserts parents and campers (health and demographics go to
   `campers/{id}/private/*`, never onto the camper document), then runs
   `decideAdmissions` (`registrationUtils/capacity.ts`) against the camp's
   `remainingSpots` read inside the same transaction: a camper is admitted as
   `PENDING_PAYMENT` with `spotReserved: true` when their track had a spot at
   the start of the request, otherwise `WAITLIST`; `forceWaitlist` waitlists
   everyone; already paid or reserved registrations keep their status.
   Siblings are compared against the starting count, so two siblings both get
   in when one spot is left. The decrement is committed with the writes.
3. **Waitlist.** Every waitlisted camper gets a Slack message and a waitlist
   email. If all campers were waitlisted the call returns without a session
   (or with a donation-only checkout session if a donation was entered).
4. **Charges** (`computeRegistrationCharges`). Per admitted camper the price is
   `campPrice`, minus `preRegistrationFee` if that camper pre-registered. The
   sibling discount applies per _paid_ sibling (waitlisted campers do not
   count, so a request padded with waitlisted siblings cannot discount the
   paid ones to zero), then camp credit (`credits/{familyId}`), floored at
   zero.
5. **Fully covered** (financial aid): registrations go `ACTIVE` immediately
   and `completeRegistration` runs (below); a donation, if any, gets its own
   checkout session.
6. **Checkout.** One Stripe line item per admitted camper carrying
   `{familyRef, registrationRef, campYear, campTrack}` metadata, an optional
   donation line, and a single discount coupon combining sibling discount and
   credit. The session expires after `REGISTRATION_CHECKOUT_EXPIRY_MINUTES`
   (45) so held spots are not tied up by abandoned checkouts. The response is
   `{status, code, sessionId, isWaitlist}`; `402` means Stripe customer or
   session creation failed (also reported to the error Slack channel).

### Webhook: handleStripeWebhook

`functions/src/stripe/handleStripeWebhook.ts`, deployed twice:
`handleStripeWebhookV2` (production keys, `lyf-v2`) and
`handleTestStripeWebhookV2` (test keys, `lyf-v2-test`).

- Rejects non-POST and bad signatures, then claims the event by
  `create()`-ing `_processedEvents/{eventId}` so a redelivered or concurrent
  event is a no-op (the collection is meant to carry a Firestore TTL policy on
  `expiresAt`; the gcloud command is in the handler). Sessions not tagged with
  this app's `metadata.app` are ignored.
- `checkout.session.completed` / `async_payment_succeeded` →
  `fulfillRegistration`: writes a `payments` document, links it to each
  registration from the line-item metadata and sets the status to `ACTIVE`
  (`PROCESSING_PAYMENT` when Stripe reports the payment as still processing),
  then `completeRegistration`.
- `checkout.session.expired` → `releaseRegistrationHolds`: for each line item
  still `PENDING_PAYMENT` with `spotReserved`, gives the spot back and clears
  the flag. The status stays `PENDING_PAYMENT` so the family's next attempt is
  re-evaluated against capacity and the website can resume it.

### completeRegistration

`functions/src/registration/fullfillRegistration.ts`, shared by the
credit-covered path and the webhook: confirmation email per camper
(MJML template), Slack message to the registration channel, Mailchimp
subscription, `remainingSpots` decrement for registrations that did not
already hold a spot, and `credits/{familyId}.amountRemaining` decrement by the
credit used. Spot arithmetic goes through `applySpotDelta`, which floors at
zero.

### Related callables

- `createPreRegistrationSession` – deposit checkout for next year; marks the
  registration `isPreRegistered`, which the full registration later credits.
- `moveCampersOffWaitlist` (admin) – sets `PENDING_PAYMENT` + `spotReserved`,
  decrements spots and emails the family; the profile page's off-waitlist
  dialog then sends them to `/registration?continueFromWaitlist=1`.
- `issueStripeRefund` (admin) – refunds a payment and records it.

## Invariants worth keeping

- Capacity is decided and decremented in the same transaction as the
  registration write; never read `remainingSpots` outside one.
- The client never supplies a price, discount or status; the website only
  chooses campers and a donation amount.
- Health and demographics never leave `campers/{id}/private/*`; registration
  documents carry only the profile fields the admin grid needs.
- Every mutating path is idempotent against Stripe retries
  (`_processedEvents`) and against repeat calls from the website (merge
  writes, status rules in `decideAdmissions`).
- Test mode is a database and key switch, not different code: anything that
  works in `lyf-v2-test` with Stripe test cards is what production will do.
