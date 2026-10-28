# lyf-registration-schemas

Shared TypeScript types for the Firestore documents and callable payloads used by
`functions/`, `website/` and `scripts/`, plus the helpers that keep them honest
(`normalizeEmail`, `CURRENT_SCHEMA_VERSION`, role capabilities, ...).

Build with `yarn workspace lyf-registration-schemas build`; the other workspaces
typecheck against `schemas/dist`, so run that after changing anything in `src/`.
Tests: `yarn workspace lyf-registration-schemas test`.

## Runtime validation

Firestore enforces nothing, which is why every document type here is a
`Partial<...>`. `src/validation.ts` adds runtime validators (built on
[zod](https://zod.dev)) so that writes and callable inputs cannot drift from the
types. Every validator comes in two forms:

```ts
validateX(input: unknown, options?: ValidateOptions): X        // throws SchemaValidationError
safeValidateX(input: unknown, options?: ValidateOptions)       // { success: true, data } | { success: false, error }
```

`SchemaValidationError` has `issues: {path, message}[]` and a message that lists
them, e.g. `Invalid Registration write (2 issues): status: Invalid option: expected
one of "Active"|...; familyEmails[1]: must be a normalized email ...`.

Each validator is pinned to its TS type at compile time: adding a field to
`Registration` without adding it to the validator fails `tsc`, and so does a
schema key that the type does not have.

### Document validators

For every document type (`Family`, `Parent`, `Camper`, `CamperHealth`,
`Demographics`, `HouseholdCulture`, `Registration`, `Payment`, `CampCredit`,
`CampYear`, `Admin`, `AdminAuditLogEntry`) there is a **write** and a **read**
flavour:

| | `validateXWrite` | `validateXRead` |
| --- | --- | --- |
| Use for | the object passed to `set()`, `set(..., {merge: true})`, `update()`, `create()` | `snapshot.data()` (website, scripts, tests) |
| Keys | all optional (merge semantics); present keys must have the right type | same |
| Sentinels | `FieldValue.serverTimestamp()` on timestamps, `arrayUnion`/`arrayRemove` on arrays (their elements are validated too), `increment` on numbers, `delete()` anywhere | rejected |
| Timestamps / refs | real SDK objects (either SDK) | real SDK objects (either SDK) |
| Emails | identity keys (`Family.emails`, `confirmedEmails`, `createdBy`, `Registration.familyEmails`, `Admin.addedBy`, audit `actor`/`target`) must be `normalizeEmail`-normalized; contact emails may be `""` | any string (legacy documents predate normalization) |
| Numbers | money and counts finite and >= 0, `schemaVersion` an integer in `1..CURRENT_SCHEMA_VERSION`, `grade` an integer in `MIN_GRADE..MAX_GRADE`, `remainingSpots`/`campSizeCaps` a map keyed by `CampTrack` (any subset of tracks) | finite numbers; `remainingSpots`/`campSizeCaps` must list every track |
| Returns | `XWrite` (e.g. `RegistrationWrite`), assignable to what both SDKs' `set`/`update` accept | `X` |

Unknown keys are rejected by default so typos are caught. Pass
`{allowUnknownKeys: true}` to accept legacy documents that carry fields the types
no longer describe:

```ts
const legacy = validateRegistrationRead(snap.data(), { allowUnknownKeys: true })
```

### Recommended pattern: validate at the write boundary

Wrap the object you are about to write, not the reference. The validator returns
the same object (typed), so the call site barely changes.

```ts
// Cloud Functions (firebase-admin)
import { FieldValue } from "firebase-admin/firestore"
import { validateRegistrationWrite, validateFamilyWrite, CURRENT_SCHEMA_VERSION } from "lyf-registration-schemas"

await registrationRef.set(
  validateRegistrationWrite({
    status,
    camper: camperRef,
    updatedAt: FieldValue.serverTimestamp(),
    familyEmails: emails, // already normalized
    schemaVersion: CURRENT_SCHEMA_VERSION,
  }),
  { merge: true }
)

await familyRef.set(
  validateFamilyWrite({ emails: FieldValue.arrayUnion(...emails), household }),
  { merge: true }
)

// Inside a transaction / batch
t.update(registrationRef, validateRegistrationWrite({ spotReserved: true }))
```

```ts
// Website (firebase client SDK)
import { serverTimestamp, updateDoc, setDoc } from "firebase/firestore"
import { validateRegistrationWrite, validateCampCreditWrite } from "lyf-registration-schemas"

await updateDoc(registrationRef, validateRegistrationWrite({ internalNotes, updatedAt: serverTimestamp() }))
await setDoc(creditRef, validateCampCreditWrite({ amountRemaining, notes }), { merge: true })
```

A failed validation throws before anything reaches Firestore. In a callable,
translate it for the client:

```ts
import { HttpsError } from "firebase-functions/v2/https"
import { SchemaValidationError, validateRegistrationPayload } from "lyf-registration-schemas"

let payload: RegistrationPayload
try {
  payload = validateRegistrationPayload(request.data)
} catch (e) {
  if (e instanceof SchemaValidationError) throw new HttpsError("invalid-argument", e.message)
  throw e
}
```

(or use `safeValidateRegistrationPayload` and branch on `result.success`).

### Callable payload validators

Client input enters through these, so they are strict:

- `validateRegistrationPayload` (`createRegistrationSession`): 1–10 parents, 1–10
  campers, `demographics.length === campers.length`, donation a finite number >= 0,
  emails that look like emails, grade an integer in `MIN_GRADE..MAX_GRADE`,
  `successUrl`/`cancelUrl` parseable URLs, enum fields (`status`, `campTrack`)
  valid.
- `validatePreRegistrationPayload` (`createPreRegistrationSession`): camper
  names, camper document paths and optional grades of equal length, campYear,
  donationAmount >= 0, email, URLs.
- `validateManageAdminRequest` (`manageAdmin`): action, email, and `role` /
  `disabled` present when the action needs them.
- `validateMoveCampersOffWaitlistRequest` (`moveCampersOffWaitlist`): parent
  emails (1–10), campYear, camperName, a bare `registrationId`, a known
  `campTrack`, `isTestData`.

Unknown keys at the top level of a payload are rejected. Inside the embedded
`family`, `parents[]`, `campers[]`, `demographics[]` and `household` objects they
are **stripped** instead: the website spreads whole Firestore documents into
those (bringing along `id`, `health`, legacy fields), so rejecting them would
break returning families. Known keys are still type-checked.
`{allowUnknownKeys: true}` keeps unknown keys everywhere.

The limits live next to the validators (`MAX_PARENTS_PER_REGISTRATION`,
`MAX_CAMPERS_PER_REGISTRATION`, `MIN_GRADE`, `MAX_GRADE`, ...) so the handlers and
the website can quote the same numbers.

### How SDK values are recognised

The client and admin SDKs have different classes for the same concepts, so the
validators check shape, not `instanceof` (`isFieldValueSentinel`,
`getFieldValueKind`, `isTimestampLike`, `isDocumentReferenceLike` are exported):

- **FieldValue sentinel** — client objects carry `_methodName`
  (`serverTimestamp`, `arrayUnion`, `arrayRemove`, `increment`, `deleteField`);
  admin objects expose a `methodName` getter (`FieldValue.serverTimestamp`, ...);
  the class name (`*FieldValueImpl` / `*Transform`) is the fallback. The kind is
  checked against the field: `serverTimestamp()` is only accepted on timestamp
  fields, `increment()` on numbers, `arrayUnion`/`arrayRemove` on arrays (and the
  elements they carry — `_elements` / `elements` — are validated against the
  array's element schema), `delete()` anywhere.
- **Timestamp** — integer `seconds` and `nanoseconds` plus `toDate()` and
  `toMillis()` (`TimestampLike`). Plain `{seconds, nanoseconds}` JSON and `Date`
  are rejected.
- **DocumentReference** — string `id` and a relative document `path` with an even
  number of segments ending in that id.

### What is deliberately not strict

- `birthDate`, `waiverSignDate` and other date-ish strings are plain strings; the
  website writes `YYYY-MM-DD`, but older documents are re-sent through the
  registration form, so a format check would reject them.
- `Payment.customerEmail` comes from Stripe and is stored as-is (not normalized).
- `Registration.demographics` (deprecated in schema version 2) is still accepted
  so that old documents validate; nothing new should write it.
- `increment()` operands and `serverTimestamp()` carry no checkable value.
- `Camper.registrations` / `Registration.payments` / `camper` fields inside a
  callable payload are typed as references but cannot survive the callable's
  JSON encoding; the website strips them before sending.
