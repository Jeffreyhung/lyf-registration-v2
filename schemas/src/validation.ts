/**
 * Runtime validators for every Firestore document type this package
 * describes, plus the callable payloads where client input enters the system.
 *
 * Firestore enforces nothing, which is why every document type is a
 * `Partial<...>`. These validators are the enforcement: call them at write
 * boundaries so new writes cannot drift from the types, and in tests / on the
 * website to check what was read back.
 *
 * Three flavours, all with the same `validateX(input, options?)` /
 * `safeValidateX(input, options?)` surface (see validationCore.ts):
 *
 *   - `validateXWrite`: the object you are about to pass to `set()`,
 *     `set(..., {merge: true})` or `update()`. Every key is optional (merge
 *     semantics) but a present key must have the right type. Top-level fields
 *     may also be a Firestore `FieldValue` sentinel of a kind that makes sense
 *     for the field (`serverTimestamp()` on timestamps, `arrayUnion()` /
 *     `arrayRemove()` on arrays, `increment()` on numbers, `delete()` on
 *     anything). Emails must already be normalized (see normalizeEmail) and
 *     money / caps must be finite and >= 0 (`remainingSpots` may be negative). Returns the input typed as
 *     `XWrite`, which is assignable to what both SDKs' `set()` / `update()`
 *     accept.
 *   - `validateXRead`: data read back from Firestore. Same keys, no
 *     sentinels; Timestamps and DocumentReferences must be real SDK objects.
 *     Normalization rules are relaxed (legacy documents predate them): only
 *     types and enums are checked.
 *   - `validateXPayload` / `validateXRequest`: callable request bodies. Strict
 *     at the top level; nested family/parent/camper/demographics objects have
 *     unknown keys stripped (the website spreads whole Firestore documents,
 *     including `id`/`health`, into them) unless `allowUnknownKeys` is set.
 *
 * Unknown keys are rejected by default everywhere else. Pass
 * `{allowUnknownKeys: true}` to accept legacy documents carrying fields the
 * types no longer describe.
 *
 * Firestore SDK values are detected structurally so the same code works with
 * `firebase` and `firebase-admin` (see validationCore.ts for the details):
 *   - FieldValue sentinel: client objects carry `_methodName`
 *     ("serverTimestamp", "arrayUnion", ...); admin objects expose a
 *     `methodName` getter ("FieldValue.serverTimestamp", ...); the class name
 *     (`*FieldValueImpl` / `*Transform`) is the fallback.
 *   - Timestamp: integer `seconds` and `nanoseconds` plus `toDate()` and
 *     `toMillis()` (TimestampLike in admin.ts).
 *   - DocumentReference: string `id` and a relative document `path` (even
 *     number of segments) ending in that id.
 *
 * Every schema is pinned to its TS type at compile time (see the
 * `SchemaMatches` checks at the bottom): adding a field to a type without
 * updating the validator fails the build.
 */
import type {
  DocumentReference,
  FieldValue,
  Timestamp,
} from "firebase/firestore"
import { z } from "zod"

import {
  ADMIN_ROLES,
  type Admin,
  type AdminAuditLogEntry,
  type ManageAdminAction,
  type ManageAdminRequest,
  type TimestampLike,
} from "./admin"
import {
  CampTrack,
  RegistrationStatus,
  type CampRemainingSpots,
  type CampYear,
  type ParentContact,
  type Registration,
} from "./camp"
import type { CampCredit } from "./credits"
import type {
  Camper,
  CamperHealth,
  Demographics,
  Family,
  HouseholdCulture,
  Parent,
} from "./families"
import type { MoveCampersOffWaitlistRequest } from "./moveCampersOffWaitlist"
import type { Payment } from "./payments"
import type { PreRegistrationInputPayload } from "./preRegistrationPayload"
import type { RegistrationPayload } from "./registrationPayload"
import { CURRENT_SCHEMA_VERSION, normalizeEmail } from "./utils"
import {
  getFieldValueKind,
  isDocumentReferenceLike,
  isTimestampLike,
  makeValidators,
  type FieldValueKind,
  type SafeValidator,
  type UnknownKeys,
  type Validator,
} from "./validationCore"

export {
  SchemaValidationError,
  formatValidationMessage,
  getFieldValueKind,
  isDocumentReferenceLike,
  isFieldValueSentinel,
  isTimestampLike,
} from "./validationCore"
export type {
  DocumentReferenceLike,
  FieldValueKind,
  SafeValidateResult,
  SafeValidator,
  SchemaValidationIssue,
  ValidateOptions,
  Validator,
} from "./validationCore"

// ---------------------------------------------------------------------------
// Limits shared with the callable handlers
// ---------------------------------------------------------------------------

/** Enforced by validateRegistrationPayload — a hand-crafted request cannot create unbounded documents. */
export const MAX_PARENTS_PER_REGISTRATION = 10
export const MAX_CAMPERS_PER_REGISTRATION = 10
/** Grade is "the grade the camper will complete"; K is 0, 13 leaves room for a gap year. */
export const MIN_GRADE = 0
export const MAX_GRADE = 13
export const MIN_CAMP_YEAR = 2000
export const MAX_CAMP_YEAR = 2100

export const MANAGE_ADMIN_ACTIONS = [
  "add",
  "setRole",
  "setDisabled",
  "remove",
] as const satisfies readonly ManageAdminAction[]

// ---------------------------------------------------------------------------
// Write-shape types: what validateXWrite returns
// ---------------------------------------------------------------------------

/** A field as it may appear in a write: the real value or a FieldValue sentinel. */
type Writable<T> = { [K in keyof T]?: T[K] | FieldValue }
type WritableRequired<T> = { [K in keyof T]: T[K] | FieldValue }

export type HouseholdCultureWrite = Writable<HouseholdCulture>
export type FamilyWrite = Omit<Writable<Family>, "household"> & {
  household?: HouseholdCultureWrite | FieldValue
}
export type ParentWrite = Writable<Parent>
export type CamperWrite = Writable<Camper>
export type CamperHealthWrite = Writable<CamperHealth>
export type DemographicsWrite = Writable<Demographics>
export type RegistrationWrite = Writable<Registration>
export type PaymentWrite = Writable<Payment>
export type CampCreditWrite = Writable<CampCredit>
/** Capacity maps may be written one track at a time (merge semantics), hence Partial. */
export type CampYearWrite = Omit<
  Writable<CampYear>,
  "campSizeCaps" | "remainingSpots"
> & {
  campSizeCaps?: Partial<Record<CampTrack, number>> | FieldValue
  remainingSpots?: Partial<CampRemainingSpots> | FieldValue
}
export type AdminWrite = Writable<Admin>
/** Audit entries are append-only full documents, so every field stays required. */
export type AdminAuditLogEntryWrite = WritableRequired<AdminAuditLogEntry>

// ---------------------------------------------------------------------------
// Schema building blocks
// ---------------------------------------------------------------------------

type Flavour = "write" | "read"
type ObjectMode = "strict" | "strip" | "loose"

type SentinelSchema = z.ZodType<FieldValue>
type FieldInner<F extends Flavour, S extends z.ZodType> = F extends "write"
  ? z.ZodUnion<readonly [S, SentinelSchema]>
  : S
type Field<F extends Flavour, S extends z.ZodType> = z.ZodOptional<
  FieldInner<F, S>
>

const DELETE_ONLY: FieldValueKind[] = ["delete"]
const TIMESTAMP_KINDS: FieldValueKind[] = ["serverTimestamp", "delete"]
const ARRAY_KINDS: FieldValueKind[] = ["arrayUnion", "arrayRemove", "delete"]
const NUMBER_KINDS: FieldValueKind[] = ["increment", "delete"]

function sentinel(kinds: FieldValueKind[]): SentinelSchema {
  return z.custom<FieldValue>(
    (value) => {
      const kind = getFieldValueKind(value)
      return kind !== null && (kind === "unknown" || kinds.includes(kind))
    },
    { message: `expected a FieldValue sentinel (${kinds.join(", ")})` }
  )
}

/**
 * Array sentinels are not opaque: `arrayUnion(...)` / `arrayRemove(...)` keep
 * their arguments on the object (`_elements` in the client SDK, `elements` in
 * the admin SDK), so the elements are validated against the array's element
 * schema. `FieldValue.arrayUnion("Parent@Example.com")` on `Family.emails`
 * therefore fails like a plain `["Parent@Example.com"]` would.
 */
function arraySentinel(element: z.ZodType): SentinelSchema {
  return sentinel(ARRAY_KINDS).check((ctx) => {
    const value = ctx.value as unknown as Record<string, unknown>
    const kind = getFieldValueKind(value)
    if (kind !== "arrayUnion" && kind !== "arrayRemove") return
    const elements = value._elements ?? value.elements
    if (!Array.isArray(elements)) return
    elements.forEach((item, index) => {
      const result = element.safeParse(item)
      if (result.success) return
      for (const issue of result.error.issues) {
        ctx.issues.push({
          ...issue,
          input: item,
          path: [index, ...issue.path],
        })
      }
    })
  })
}

type ArrayField<F extends Flavour, E extends z.ZodType> = Field<
  F,
  z.ZodArray<E>
>

/** An optional array field; on writes also an arrayUnion/arrayRemove/delete sentinel. */
function arrayField<F extends Flavour, E extends z.ZodType>(
  flavour: F,
  element: E
): ArrayField<F, E> {
  const array = z.array(element)
  const inner =
    flavour === "write" ? z.union([array, arraySentinel(element)]) : array
  return inner.optional() as unknown as ArrayField<F, E>
}

/** A required field: `schema`, or on writes also a sentinel of the given kinds. */
function required<F extends Flavour, S extends z.ZodType>(
  flavour: F,
  schema: S,
  kinds: FieldValueKind[] = DELETE_ONLY
): FieldInner<F, S> {
  const inner =
    flavour === "write" ? z.union([schema, sentinel(kinds)]) : schema
  return inner as unknown as FieldInner<F, S>
}

/** An optional field (merge semantics): `required(...)` wrapped in `.optional()`. */
function field<F extends Flavour, S extends z.ZodType>(
  flavour: F,
  schema: S,
  kinds: FieldValueKind[] = DELETE_ONLY
): Field<F, S> {
  return required(flavour, schema, kinds).optional() as unknown as Field<F, S>
}

function obj<S extends z.ZodRawShape>(
  mode: ObjectMode,
  shape: S
): z.ZodObject<S> {
  switch (mode) {
    case "strict":
      return z.strictObject(shape) as unknown as z.ZodObject<S>
    case "strip":
      return z.object(shape)
    case "loose":
      return z.looseObject(shape) as unknown as z.ZodObject<S>
  }
}

/** Document validators: unknown keys are rejected unless explicitly allowed. */
function docMode(unknownKeys: UnknownKeys): ObjectMode {
  return unknownKeys === "allow" ? "loose" : "strict"
}

// Deliberately tolerant: Firestore stores whatever Stripe / the form provided
// and the website's own checks are looser than RFC 5322. We only want to
// catch values that are clearly not addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const emailSchema = z
  .string()
  .regex(EMAIL_PATTERN, "must look like an email address")
export const normalizedEmailSchema = emailSchema.refine(
  (value) => value === normalizeEmail(value),
  "must be a normalized email (trimmed and lowercase, see normalizeEmail)"
)

function emptyOr<S extends z.ZodType<string>>(schema: S): z.ZodType<string> {
  return z.union([z.literal(""), schema])
}

/** Identity-key emails (family membership, admins): normalized on write, any string on read. */
function identityEmail(flavour: Flavour): z.ZodType<string> {
  return flavour === "write" ? normalizedEmailSchema : z.string()
}

/** Contact emails that may legitimately be blank (a parent keyed by phone number). */
function contactEmail(flavour: Flavour): z.ZodType<string> {
  return flavour === "write" ? emptyOr(normalizedEmailSchema) : z.string()
}

/** Dollar amounts and prices: finite, and >= 0 when written. */
function amount(flavour: Flavour): z.ZodType<number> {
  return flavour === "write" ? z.number().min(0) : z.number()
}

/** Capacity caps: non-negative integers when written. */
function count(flavour: Flavour): z.ZodType<number> {
  return flavour === "write" ? z.int().min(0) : z.number()
}

/**
 * Remaining-spot counts: any integer when written. Admitting campers over the
 * cap (bypass emails, admins moving a waitlist) is a normal operational state
 * and drives the count negative; production camp years already hold negative
 * values, and a write that only touches one track spreads the others back.
 */
function spotCount(flavour: Flavour): z.ZodType<number> {
  return flavour === "write" ? z.int() : z.number()
}

function schemaVersion(flavour: Flavour): z.ZodType<number> {
  const base = z.int().min(1)
  return flavour === "write" ? base.max(CURRENT_SCHEMA_VERSION) : base
}

const gradeSchema = z.int().min(MIN_GRADE).max(MAX_GRADE)
function grade(flavour: Flavour): z.ZodType<number> {
  return flavour === "write" ? gradeSchema : z.number()
}

const campYearNumber = z.int().min(MIN_CAMP_YEAR).max(MAX_CAMP_YEAR)

const nullableString = z.string().nullable()

const timestamp = z.custom<Timestamp>(isTimestampLike, {
  message: "expected a Firestore Timestamp",
})
const timestampLike = z.custom<TimestampLike>(isTimestampLike, {
  message: "expected a Firestore Timestamp",
})
function docRef<T>(): z.ZodType<DocumentReference<T>> {
  return z.custom<DocumentReference<T>>(isDocumentReferenceLike, {
    message: "expected a DocumentReference",
  })
}

const campTrackSchema = z.enum(CampTrack)
const registrationStatusSchema = z.enum(RegistrationStatus)
const adminRoleSchema = z.enum(ADMIN_ROLES)
const manageAdminActionSchema = z.enum(MANAGE_ADMIN_ACTIONS)

type TrackMap<F extends Flavour> = F extends "write"
  ? z.ZodType<Partial<Record<CampTrack, number>>>
  : z.ZodType<Record<CampTrack, number>>

/** Per-track capacity maps: every track on read, any subset on (merge) write. */
function trackMap<F extends Flavour>(
  flavour: F,
  value: z.ZodType<number> = count(flavour)
): TrackMap<F> {
  const map =
    flavour === "write"
      ? z.partialRecord(campTrackSchema, value)
      : z.record(campTrackSchema, value)
  return map as unknown as TrackMap<F>
}

// ---------------------------------------------------------------------------
// Document shapes
// ---------------------------------------------------------------------------

const householdCultureShape = <F extends Flavour>(f: F) => ({
  camperMessage: field(f, z.string()),
  languageFrequency: field(f, z.string()),
  cultureConfidence: field(f, z.string()),
  cultureLearn: field(f, z.string()),
  cultureBarrier: field(f, z.string()),
  cultureLesson: field(f, z.string()),
})

const familyShape = <F extends Flavour>(f: F, mode: ObjectMode) => ({
  city: field(f, z.string()),
  emails: arrayField(f, identityEmail(f)),
  createdBy: field(f, identityEmail(f)),
  confirmedEmails: arrayField(f, identityEmail(f)),
  country: field(f, z.string()),
  state: field(f, z.string()),
  street: field(f, z.string()),
  suite: field(f, z.string()),
  zip: field(f, z.string()),
  household: field(f, obj(mode, householdCultureShape(f))),
  isTestData: field(f, z.boolean()),
  schemaVersion: field(f, schemaVersion(f)),
})

const parentShape = <F extends Flavour>(f: F) => ({
  email: field(f, contactEmail(f)),
  firstName: field(f, z.string()),
  lastName: field(f, z.string()),
  lineId: field(f, z.string()),
  phoneNumber: field(f, z.string()),
  subscribeToMailingList: field(f, z.boolean()),
  stripeCustomerId: field(f, z.string()),
})

const camperShape = <F extends Flavour>(f: F) => ({
  id: field(f, z.string()),
  firstName: field(f, z.string()),
  lastName: field(f, z.string()),
  preferredName: field(f, nullableString),
  birthDate: field(f, z.string()),
  gender: arrayField(f, z.string()),
  pronouns: field(f, nullableString),
  registrations: arrayField(f, docRef<Registration>()),
  isTestData: field(f, z.boolean()),
  schemaVersion: field(f, schemaVersion(f)),
})

const camperHealthShape = <F extends Flavour>(f: F) => ({
  dietAndFoodAllergies: field(f, nullableString),
  medicalConditions: field(f, nullableString),
})

const demographicsShape = <F extends Flavour>(f: F) => ({
  born: field(f, z.string()),
  ethnicity: arrayField(f, z.string()),
  generation: field(f, z.string()),
  hakkaLanguage: field(f, z.string()),
  hokkienLanguage: field(f, z.string()),
  mandarinLanguage: field(f, z.string()),
  otherBackground: field(f, z.string()),
  otherLanguage: field(f, z.string()),
  immediateFamily: field(f, z.string()),
})

const parentContactShape = (f: Flavour) => ({
  firstName: z.string(),
  lastName: z.string(),
  email: contactEmail(f),
  phoneNumber: z.string(),
})

const registrationShape = <F extends Flavour>(f: F, mode: ObjectMode) => ({
  camperName: field(f, z.string()),
  camper: field(f, docRef<Camper>()),
  campTrack: field(f, campTrackSchema),

  grade: field(f, grade(f)),
  isPreRegistered: field(f, z.boolean()),
  amountPaid: field(f, amount(f), NUMBER_KINDS),
  status: field(f, registrationStatusSchema),
  shirtSize: field(f, z.string()),
  isReturning: field(f, z.boolean()),
  smallGroup: field(f, z.string()),
  cabinPreference: field(f, z.string()),

  createdAt: field(f, timestamp, TIMESTAMP_KINDS),
  updatedAt: field(f, timestamp, TIMESTAMP_KINDS),
  waitlistTime: field(f, timestamp, TIMESTAMP_KINDS),

  payments: arrayField(f, docRef<Payment>()),

  additionalNotes: field(f, nullableString),
  internalNotes: field(f, nullableString),

  hasContacted: field(f, z.literal(true)),

  checkedOutTime: field(f, timestamp, TIMESTAMP_KINDS),
  isCheckedOut: field(f, z.boolean()),
  nameOfParentCheckedOut: field(f, z.string()),

  waiverFullName: field(f, z.string()),
  waiverSignature: field(f, z.string()),
  waiverSignDate: field(f, z.string()),

  // Deprecated (schemaVersion 2) but still part of the type for old documents.
  demographics: field(
    f,
    z.record(z.string(), z.union([z.string(), z.array(z.string())]))
  ),

  isTestData: field(f, z.boolean()),

  firstName: field(f, z.string()),
  lastName: field(f, z.string()),
  preferredName: field(f, nullableString),
  birthDate: field(f, z.string()),
  gender: arrayField(f, z.string()),
  pronouns: field(f, nullableString),
  parentContacts: arrayField(f, obj(mode, parentContactShape(f))),

  spotReserved: field(f, z.boolean()),

  familyEmails: arrayField(f, identityEmail(f)),
  schemaVersion: field(f, schemaVersion(f)),
})

const paymentItemShape = (f: Flavour) => ({
  amount: amount(f),
  description: z.string(),
})

const paymentDiscountShape = (f: Flavour) => ({
  name: z.string(),
  amount: amount(f),
})

const paymentShape = <F extends Flavour>(f: F, mode: ObjectMode) => ({
  createdAt: field(f, timestamp, TIMESTAMP_KINDS),
  customerEmail: field(f, z.string()),
  customerId: field(f, z.string()),
  customerName: field(f, z.string()),

  donation: field(f, amount(f), NUMBER_KINDS),
  items: arrayField(f, obj(mode, paymentItemShape(f))),
  discount: field(f, obj(mode, paymentDiscountShape(f)).nullable()),

  paymentMethod: field(f, z.string()),
  registrations: arrayField(f, docRef<Registration>()),
  status: field(f, z.string()),
  stripeId: field(f, z.string()),
  total: field(f, amount(f), NUMBER_KINDS),
  type: field(f, z.string()),
  updatedAt: field(f, timestamp, TIMESTAMP_KINDS),
})

const campCreditShape = <F extends Flavour>(f: F) => ({
  amountRemaining: field(f, amount(f), NUMBER_KINDS),
  family: field(f, docRef<Family>()),
  notes: arrayField(f, z.string()),
})

const campYearShape = <F extends Flavour>(f: F) => ({
  campEndDate: field(f, timestamp, TIMESTAMP_KINDS),
  campStartDate: field(f, timestamp, TIMESTAMP_KINDS),
  campTotalSizeCap: field(f, count(f), NUMBER_KINDS),
  campSizeCaps: field(f, trackMap(f)),

  campsite: field(f, z.string()),
  campsiteAddress: field(f, z.string()),

  earlyRegDiscount: field(f, amount(f), NUMBER_KINDS),
  earlyRegEndDate: field(f, timestamp, TIMESTAMP_KINDS),
  earlyRegOpenDate: field(f, timestamp, TIMESTAMP_KINDS),
  preRegistrationOpenDate: field(f, timestamp, TIMESTAMP_KINDS),
  preRegistrationCloseDate: field(f, timestamp, TIMESTAMP_KINDS),
  infoSessionDate: field(f, timestamp, TIMESTAMP_KINDS),

  // Per-year images and display toggles (set from the Camp Year tab).
  infoSessionImageUrl: field(f, z.string()),
  emailHeaderImageUrl: field(f, z.string()),
  showWaitlistHeaderBar: field(f, z.boolean()),
  showRemainingSpots: field(f, z.boolean()),
  showWaitlistPosition: field(f, z.boolean()),

  name: field(f, z.string()),

  preRegistrationFee: field(f, amount(f), NUMBER_KINDS),
  registrationCloseDate: field(f, timestamp, TIMESTAMP_KINDS),
  registrationFee: field(f, amount(f), NUMBER_KINDS),
  registrationLateDate: field(f, timestamp, TIMESTAMP_KINDS),
  registrationLateFee: field(f, amount(f), NUMBER_KINDS),
  registrationOpenDate: field(f, timestamp, TIMESTAMP_KINDS),

  shirtPrice: field(f, amount(f), NUMBER_KINDS),
  siblingDiscount: field(f, amount(f), NUMBER_KINDS),

  // May be negative: see spotCount.
  remainingSpots: field(f, trackMap(f, spotCount(f))),
})

const adminShape = <F extends Flavour>(f: F) => ({
  role: field(f, adminRoleSchema),
  addedBy: field(f, identityEmail(f)),
  addedAt: field(f, timestampLike, TIMESTAMP_KINDS),
  disabled: field(f, z.boolean()),
})

// `before`/`after` are snapshots of admin documents, so they use the read shape
// even inside a write (the handler copies them out of a transaction read).
const adminAuditLogEntryShape = <F extends Flavour>(
  f: F,
  mode: ObjectMode
) => ({
  actor: required(f, identityEmail(f)),
  action: required(f, manageAdminActionSchema),
  target: required(f, identityEmail(f)),
  before: required(f, obj(mode, adminShape("read")).nullable()),
  after: required(f, obj(mode, adminShape("read")).nullable()),
  at: required(f, timestampLike, TIMESTAMP_KINDS),
})

// ---------------------------------------------------------------------------
// Document schemas (strict variants, used for the compile-time checks)
// ---------------------------------------------------------------------------

const buildHouseholdCulture = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), householdCultureShape(f))
const buildFamily = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), familyShape(f, docMode(u)))
const buildParent = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), parentShape(f))
const buildCamper = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), camperShape(f))
const buildCamperHealth = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), camperHealthShape(f))
const buildDemographics = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), demographicsShape(f))
const buildParentContact = (f: Flavour, u: UnknownKeys) =>
  obj(docMode(u), parentContactShape(f))
const buildRegistration = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), registrationShape(f, docMode(u)))
const buildPayment = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), paymentShape(f, docMode(u)))
const buildCampCredit = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), campCreditShape(f))
const buildCampYear = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), campYearShape(f))
const buildAdmin = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), adminShape(f))
const buildAdminAuditLogEntry = <F extends Flavour>(f: F, u: UnknownKeys) =>
  obj(docMode(u), adminAuditLogEntryShape(f, docMode(u)))

const householdCultureWriteSchema = buildHouseholdCulture("write", "reject")
const householdCultureReadSchema = buildHouseholdCulture("read", "reject")
const familyWriteSchema = buildFamily("write", "reject")
const familyReadSchema = buildFamily("read", "reject")
const parentWriteSchema = buildParent("write", "reject")
const parentReadSchema = buildParent("read", "reject")
const camperWriteSchema = buildCamper("write", "reject")
const camperReadSchema = buildCamper("read", "reject")
const camperHealthWriteSchema = buildCamperHealth("write", "reject")
const camperHealthReadSchema = buildCamperHealth("read", "reject")
const demographicsWriteSchema = buildDemographics("write", "reject")
const demographicsReadSchema = buildDemographics("read", "reject")
const parentContactReadSchema = buildParentContact("read", "reject")
const registrationWriteSchema = buildRegistration("write", "reject")
const registrationReadSchema = buildRegistration("read", "reject")
const paymentWriteSchema = buildPayment("write", "reject")
const paymentReadSchema = buildPayment("read", "reject")
const campCreditWriteSchema = buildCampCredit("write", "reject")
const campCreditReadSchema = buildCampCredit("read", "reject")
const campYearWriteSchema = buildCampYear("write", "reject")
const campYearReadSchema = buildCampYear("read", "reject")
const adminWriteSchema = buildAdmin("write", "reject")
const adminReadSchema = buildAdmin("read", "reject")
const adminAuditLogEntryWriteSchema = buildAdminAuditLogEntry("write", "reject")
const adminAuditLogEntryReadSchema = buildAdminAuditLogEntry("read", "reject")

// ---------------------------------------------------------------------------
// Document validators
// ---------------------------------------------------------------------------

function docValidators<T>(
  label: string,
  strictSchema: z.ZodType,
  build: (u: UnknownKeys) => z.ZodType
): { validate: Validator<T>; safeValidate: SafeValidator<T> } {
  return makeValidators<T>(label, (u) =>
    u === "reject" ? strictSchema : build(u)
  )
}

const householdCultureWrite = docValidators<HouseholdCultureWrite>(
  "HouseholdCulture write",
  householdCultureWriteSchema,
  (u) => buildHouseholdCulture("write", u)
)
const householdCultureRead = docValidators<HouseholdCulture>(
  "HouseholdCulture",
  householdCultureReadSchema,
  (u) => buildHouseholdCulture("read", u)
)
const familyWrite = docValidators<FamilyWrite>(
  "Family write",
  familyWriteSchema,
  (u) => buildFamily("write", u)
)
const familyRead = docValidators<Family>("Family", familyReadSchema, (u) =>
  buildFamily("read", u)
)
const parentWrite = docValidators<ParentWrite>(
  "Parent write",
  parentWriteSchema,
  (u) => buildParent("write", u)
)
const parentRead = docValidators<Parent>("Parent", parentReadSchema, (u) =>
  buildParent("read", u)
)
const camperWrite = docValidators<CamperWrite>(
  "Camper write",
  camperWriteSchema,
  (u) => buildCamper("write", u)
)
const camperRead = docValidators<Camper>("Camper", camperReadSchema, (u) =>
  buildCamper("read", u)
)
const camperHealthWrite = docValidators<CamperHealthWrite>(
  "CamperHealth write",
  camperHealthWriteSchema,
  (u) => buildCamperHealth("write", u)
)
const camperHealthRead = docValidators<CamperHealth>(
  "CamperHealth",
  camperHealthReadSchema,
  (u) => buildCamperHealth("read", u)
)
const demographicsWrite = docValidators<DemographicsWrite>(
  "Demographics write",
  demographicsWriteSchema,
  (u) => buildDemographics("write", u)
)
const demographicsRead = docValidators<Demographics>(
  "Demographics",
  demographicsReadSchema,
  (u) => buildDemographics("read", u)
)
const registrationWrite = docValidators<RegistrationWrite>(
  "Registration write",
  registrationWriteSchema,
  (u) => buildRegistration("write", u)
)
const registrationRead = docValidators<Registration>(
  "Registration",
  registrationReadSchema,
  (u) => buildRegistration("read", u)
)
const paymentWrite = docValidators<PaymentWrite>(
  "Payment write",
  paymentWriteSchema,
  (u) => buildPayment("write", u)
)
const paymentRead = docValidators<Payment>("Payment", paymentReadSchema, (u) =>
  buildPayment("read", u)
)
const campCreditWrite = docValidators<CampCreditWrite>(
  "CampCredit write",
  campCreditWriteSchema,
  (u) => buildCampCredit("write", u)
)
const campCreditRead = docValidators<CampCredit>(
  "CampCredit",
  campCreditReadSchema,
  (u) => buildCampCredit("read", u)
)
const campYearWrite = docValidators<CampYearWrite>(
  "CampYear write",
  campYearWriteSchema,
  (u) => buildCampYear("write", u)
)
const campYearRead = docValidators<CampYear>(
  "CampYear",
  campYearReadSchema,
  (u) => buildCampYear("read", u)
)
const adminWrite = docValidators<AdminWrite>(
  "Admin write",
  adminWriteSchema,
  (u) => buildAdmin("write", u)
)
const adminRead = docValidators<Admin>("Admin", adminReadSchema, (u) =>
  buildAdmin("read", u)
)
const adminAuditLogEntryWrite = docValidators<AdminAuditLogEntryWrite>(
  "AdminAuditLogEntry write",
  adminAuditLogEntryWriteSchema,
  (u) => buildAdminAuditLogEntry("write", u)
)
const adminAuditLogEntryRead = docValidators<AdminAuditLogEntry>(
  "AdminAuditLogEntry",
  adminAuditLogEntryReadSchema,
  (u) => buildAdminAuditLogEntry("read", u)
)

// Family — families/{familyId}
export const validateFamilyWrite: Validator<FamilyWrite> = familyWrite.validate
export const safeValidateFamilyWrite: SafeValidator<FamilyWrite> =
  familyWrite.safeValidate
export const validateFamilyRead: Validator<Family> = familyRead.validate
export const safeValidateFamilyRead: SafeValidator<Family> =
  familyRead.safeValidate

// Parent — families/{familyId}/parents/{parentId}
export const validateParentWrite: Validator<ParentWrite> = parentWrite.validate
export const safeValidateParentWrite: SafeValidator<ParentWrite> =
  parentWrite.safeValidate
export const validateParentRead: Validator<Parent> = parentRead.validate
export const safeValidateParentRead: SafeValidator<Parent> =
  parentRead.safeValidate

// Camper — families/{familyId}/campers/{camperId}
export const validateCamperWrite: Validator<CamperWrite> = camperWrite.validate
export const safeValidateCamperWrite: SafeValidator<CamperWrite> =
  camperWrite.safeValidate
export const validateCamperRead: Validator<Camper> = camperRead.validate
export const safeValidateCamperRead: SafeValidator<Camper> =
  camperRead.safeValidate

// CamperHealth — families/{familyId}/campers/{camperId}/private/health
export const validateCamperHealthWrite: Validator<CamperHealthWrite> =
  camperHealthWrite.validate
export const safeValidateCamperHealthWrite: SafeValidator<CamperHealthWrite> =
  camperHealthWrite.safeValidate
export const validateCamperHealthRead: Validator<CamperHealth> =
  camperHealthRead.validate
export const safeValidateCamperHealthRead: SafeValidator<CamperHealth> =
  camperHealthRead.safeValidate

// Demographics — families/{familyId}/campers/{camperId}/private/demographics
export const validateDemographicsWrite: Validator<DemographicsWrite> =
  demographicsWrite.validate
export const safeValidateDemographicsWrite: SafeValidator<DemographicsWrite> =
  demographicsWrite.safeValidate
export const validateDemographicsRead: Validator<Demographics> =
  demographicsRead.validate
export const safeValidateDemographicsRead: SafeValidator<Demographics> =
  demographicsRead.safeValidate

// HouseholdCulture — embedded in Family.household
export const validateHouseholdCultureWrite: Validator<HouseholdCultureWrite> =
  householdCultureWrite.validate
export const safeValidateHouseholdCultureWrite: SafeValidator<HouseholdCultureWrite> =
  householdCultureWrite.safeValidate
export const validateHouseholdCultureRead: Validator<HouseholdCulture> =
  householdCultureRead.validate
export const safeValidateHouseholdCultureRead: SafeValidator<HouseholdCulture> =
  householdCultureRead.safeValidate

// Registration — camps/{year}/registrations/{registrationId}
export const validateRegistrationWrite: Validator<RegistrationWrite> =
  registrationWrite.validate
export const safeValidateRegistrationWrite: SafeValidator<RegistrationWrite> =
  registrationWrite.safeValidate
export const validateRegistrationRead: Validator<Registration> =
  registrationRead.validate
export const safeValidateRegistrationRead: SafeValidator<Registration> =
  registrationRead.safeValidate

// Payment — payments/{stripeSessionId}
export const validatePaymentWrite: Validator<PaymentWrite> =
  paymentWrite.validate
export const safeValidatePaymentWrite: SafeValidator<PaymentWrite> =
  paymentWrite.safeValidate
export const validatePaymentRead: Validator<Payment> = paymentRead.validate
export const safeValidatePaymentRead: SafeValidator<Payment> =
  paymentRead.safeValidate

// CampCredit — credits/{familyId}
export const validateCampCreditWrite: Validator<CampCreditWrite> =
  campCreditWrite.validate
export const safeValidateCampCreditWrite: SafeValidator<CampCreditWrite> =
  campCreditWrite.safeValidate
export const validateCampCreditRead: Validator<CampCredit> =
  campCreditRead.validate
export const safeValidateCampCreditRead: SafeValidator<CampCredit> =
  campCreditRead.safeValidate

// CampYear — camps/{year}
export const validateCampYearWrite: Validator<CampYearWrite> =
  campYearWrite.validate
export const safeValidateCampYearWrite: SafeValidator<CampYearWrite> =
  campYearWrite.safeValidate
export const validateCampYearRead: Validator<CampYear> = campYearRead.validate
export const safeValidateCampYearRead: SafeValidator<CampYear> =
  campYearRead.safeValidate

// Admin — admins/{email}
export const validateAdminWrite: Validator<AdminWrite> = adminWrite.validate
export const safeValidateAdminWrite: SafeValidator<AdminWrite> =
  adminWrite.safeValidate
export const validateAdminRead: Validator<Admin> = adminRead.validate
export const safeValidateAdminRead: SafeValidator<Admin> =
  adminRead.safeValidate

// AdminAuditLogEntry — adminAuditLog/{autoId}
export const validateAdminAuditLogEntryWrite: Validator<AdminAuditLogEntryWrite> =
  adminAuditLogEntryWrite.validate
export const safeValidateAdminAuditLogEntryWrite: SafeValidator<AdminAuditLogEntryWrite> =
  adminAuditLogEntryWrite.safeValidate
export const validateAdminAuditLogEntryRead: Validator<AdminAuditLogEntry> =
  adminAuditLogEntryRead.validate
export const safeValidateAdminAuditLogEntryRead: SafeValidator<AdminAuditLogEntry> =
  adminAuditLogEntryRead.safeValidate

// ---------------------------------------------------------------------------
// Callable payloads
// ---------------------------------------------------------------------------

/** Top level of a request body: typos are rejected unless the caller opts out. */
function payloadMode(unknownKeys: UnknownKeys): ObjectMode {
  return unknownKeys === "allow" ? "loose" : "strict"
}

/**
 * Document-shaped objects embedded in a request. The website spreads whole
 * Firestore documents into these (adding `id`, `ref`-stripped leftovers,
 * `health`, legacy fields), so unknown keys are stripped rather than rejected;
 * the known keys are still type-checked.
 */
function embeddedMode(unknownKeys: UnknownKeys): ObjectMode {
  return unknownKeys === "allow" ? "loose" : "strip"
}

const urlSchema = z.url()

/** A relative Firestore document path such as `families/{f}/campers/{c}`. */
const documentPathSchema = z.string().refine((path) => {
  const segments = path.split("/")
  return (
    segments.length >= 2 &&
    segments.length % 2 === 0 &&
    segments.every((s) => s.length > 0)
  )
}, "must be a Firestore document path (collection/doc[/collection/doc...])")

/**
 * A camper document path, `families/{familyId}/campers/{camperId}`. The
 * pre-registration callable stamps this path into Stripe metadata and the
 * webhook later writes to it (and to its parent family), so the shape is
 * pinned here rather than accepting any document path.
 */
const camperDocumentPathSchema = documentPathSchema.refine((path) => {
  const segments = path.split("/")
  return (
    segments.length === 4 &&
    segments[0] === "families" &&
    segments[2] === "campers"
  )
}, "must be a camper document path (families/{familyId}/campers/{camperId})")

const buildRegistrationPayload = (u: UnknownKeys) => {
  const embedded = embeddedMode(u)
  const camperPayload = obj(embedded, {
    ...camperShape("read"),
    ...camperHealthShape("read"),
    ...registrationShape("read", embedded),
    grade: gradeSchema.optional(),
  })
  const parentPayload = obj(embedded, {
    ...parentShape("read"),
    email: emptyOr(emailSchema).optional(),
  })

  return obj(payloadMode(u), {
    campYear: campYearNumber,
    family: obj(embedded, familyShape("read", embedded)),
    parents: z
      .array(parentPayload)
      .min(1, "At least one parent is required")
      .max(
        MAX_PARENTS_PER_REGISTRATION,
        `At most ${MAX_PARENTS_PER_REGISTRATION} parents may be submitted`
      ),
    campers: z
      .array(camperPayload)
      .min(1, "At least one camper is required")
      .max(
        MAX_CAMPERS_PER_REGISTRATION,
        `At most ${MAX_CAMPERS_PER_REGISTRATION} campers may be registered at once`
      ),
    demographics: z.array(obj(embedded, demographicsShape("read"))),
    donation: z.number().min(0),
    household: obj(embedded, householdCultureShape("read")),
    joinFamilyId: z.string().nullable().optional(),
    successUrl: urlSchema,
    cancelUrl: urlSchema,
    isTestData: z.boolean().optional(),
    forceWaitlist: z.boolean().optional(),
  }).check((ctx) => {
    const { campers, demographics } = ctx.value
    if (demographics.length !== campers.length) {
      ctx.issues.push({
        code: "custom",
        input: demographics,
        path: ["demographics"],
        message: "demographics must contain one entry per camper",
      })
    }
  })
}

const buildPreRegistrationPayload = (u: UnknownKeys) =>
  obj(payloadMode(u), {
    campersToPreRegister: z
      .array(z.string().min(1))
      .max(MAX_CAMPERS_PER_REGISTRATION),
    camperRefsToPreRegister: z
      .array(camperDocumentPathSchema)
      .max(MAX_CAMPERS_PER_REGISTRATION),
    // The website derives a camper's current grade from this year's active
    // registration and sends `false` (not null) for a camper who did not
    // attend this year; an undefined slot is the same "no grade" case. Both
    // normalize to null so the pre-registration fulfils with no grade.
    camperCurrentGrades: z
      .array(
        z.preprocess(
          (grade) => (grade === false || grade === undefined ? null : grade),
          gradeSchema.nullable()
        )
      )
      .optional(),
    campYear: campYearNumber,
    donationAmount: z.number().min(0),
    email: emailSchema,
    successUrl: urlSchema,
    cancelUrl: urlSchema,
    isTestData: z.boolean().optional(),
  }).check((ctx) => {
    const {
      campersToPreRegister,
      camperRefsToPreRegister,
      camperCurrentGrades,
    } = ctx.value
    if (camperRefsToPreRegister.length !== campersToPreRegister.length) {
      ctx.issues.push({
        code: "custom",
        input: camperRefsToPreRegister,
        path: ["camperRefsToPreRegister"],
        message: "must contain one entry per camper in campersToPreRegister",
      })
    }
    if (
      camperCurrentGrades &&
      camperCurrentGrades.length !== campersToPreRegister.length
    ) {
      ctx.issues.push({
        code: "custom",
        input: camperCurrentGrades,
        path: ["camperCurrentGrades"],
        message: "must contain one entry per camper in campersToPreRegister",
      })
    }
  })

const buildManageAdminRequest = (u: UnknownKeys) =>
  obj(payloadMode(u), {
    action: manageAdminActionSchema,
    email: emailSchema,
    role: adminRoleSchema.optional(),
    disabled: z.boolean().optional(),
  }).check((ctx) => {
    const { action, role, disabled } = ctx.value
    if ((action === "add" || action === "setRole") && role === undefined) {
      ctx.issues.push({
        code: "custom",
        input: role,
        path: ["role"],
        message: `role is required for action "${action}"`,
      })
    }
    if (action === "setDisabled" && disabled === undefined) {
      ctx.issues.push({
        code: "custom",
        input: disabled,
        path: ["disabled"],
        message: 'disabled is required for action "setDisabled"',
      })
    }
  })

const CAMP_TRACK_VALUES: readonly string[] = Object.values(CampTrack)

const buildMoveCampersOffWaitlistRequest = (u: UnknownKeys) =>
  obj(payloadMode(u), {
    parentNames: z.array(z.string()).max(MAX_PARENTS_PER_REGISTRATION),
    parentEmails: z
      .array(emailSchema)
      .min(1, "At least one parent email is required")
      .max(MAX_PARENTS_PER_REGISTRATION),
    campYear: campYearNumber,
    camperName: z.string().min(1),
    registrationId: z
      .string()
      .min(1)
      .refine((id) => !id.includes("/"), "must be a document id, not a path"),
    campTrack: z.string().refine((track) => CAMP_TRACK_VALUES.includes(track), {
      message: `must be one of ${CAMP_TRACK_VALUES.map((t) => `"${t}"`).join(
        ", "
      )}`,
    }),
    isTestData: z.boolean(),
  })

const registrationPayloadSchema = buildRegistrationPayload("reject")
const preRegistrationPayloadSchema = buildPreRegistrationPayload("reject")
const manageAdminRequestSchema = buildManageAdminRequest("reject")
const moveCampersOffWaitlistRequestSchema =
  buildMoveCampersOffWaitlistRequest("reject")

const registrationPayload = docValidators<RegistrationPayload>(
  "RegistrationPayload",
  registrationPayloadSchema,
  buildRegistrationPayload
)
const preRegistrationPayload = docValidators<PreRegistrationInputPayload>(
  "PreRegistrationInputPayload",
  preRegistrationPayloadSchema,
  buildPreRegistrationPayload
)
const manageAdminRequest = docValidators<ManageAdminRequest>(
  "ManageAdminRequest",
  manageAdminRequestSchema,
  buildManageAdminRequest
)
const moveCampersOffWaitlistRequest =
  docValidators<MoveCampersOffWaitlistRequest>(
    "MoveCampersOffWaitlistRequest",
    moveCampersOffWaitlistRequestSchema,
    buildMoveCampersOffWaitlistRequest
  )

/** createRegistrationSession request body. */
export const validateRegistrationPayload: Validator<RegistrationPayload> =
  registrationPayload.validate
export const safeValidateRegistrationPayload: SafeValidator<RegistrationPayload> =
  registrationPayload.safeValidate

/** createPreRegistrationSession request body. */
export const validatePreRegistrationPayload: Validator<PreRegistrationInputPayload> =
  preRegistrationPayload.validate
export const safeValidatePreRegistrationPayload: SafeValidator<PreRegistrationInputPayload> =
  preRegistrationPayload.safeValidate

/** manageAdmin request body (also checks role/disabled are present for the actions that need them). */
export const validateManageAdminRequest: Validator<ManageAdminRequest> =
  manageAdminRequest.validate
export const safeValidateManageAdminRequest: SafeValidator<ManageAdminRequest> =
  manageAdminRequest.safeValidate

/** moveCampersOffWaitlist request body. */
export const validateMoveCampersOffWaitlistRequest: Validator<MoveCampersOffWaitlistRequest> =
  moveCampersOffWaitlistRequest.validate
export const safeValidateMoveCampersOffWaitlistRequest: SafeValidator<MoveCampersOffWaitlistRequest> =
  moveCampersOffWaitlistRequest.safeValidate

// ---------------------------------------------------------------------------
// Compile-time drift protection
// ---------------------------------------------------------------------------
// Each schema's output must be mutually assignable with its TS type AND have
// exactly the same set of keys. Mutual assignability alone would let a schema
// silently miss an optional field (every document field is optional), so the
// key-set check is what catches "added a field to the type, forgot the
// validator". A failure shows up as `true` not being assignable to an object
// describing the mismatch.

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type SchemaMatches<S extends z.ZodType, T> = Mutual<z.output<S>, T> extends true
  ? Mutual<keyof z.output<S>, keyof T> extends true
    ? true
    : {
        error: "schema keys differ from type"
        schemaKeys: keyof z.output<S>
        typeKeys: keyof T
      }
  : {
      error: "schema output is not mutually assignable with type"
      output: z.output<S>
      type: T
    }

type PaymentItem = NonNullable<Payment["items"]>[number]
type PaymentDiscount = NonNullable<Payment["discount"]>

/* eslint-disable @typescript-eslint/no-unused-vars */
const _householdCultureRead: SchemaMatches<
  typeof householdCultureReadSchema,
  HouseholdCulture
> = true
const _householdCultureWrite: SchemaMatches<
  typeof householdCultureWriteSchema,
  HouseholdCultureWrite
> = true
const _familyRead: SchemaMatches<typeof familyReadSchema, Family> = true
const _familyWrite: SchemaMatches<typeof familyWriteSchema, FamilyWrite> = true
const _parentRead: SchemaMatches<typeof parentReadSchema, Parent> = true
const _parentWrite: SchemaMatches<typeof parentWriteSchema, ParentWrite> = true
const _camperRead: SchemaMatches<typeof camperReadSchema, Camper> = true
const _camperWrite: SchemaMatches<typeof camperWriteSchema, CamperWrite> = true
const _camperHealthRead: SchemaMatches<
  typeof camperHealthReadSchema,
  CamperHealth
> = true
const _camperHealthWrite: SchemaMatches<
  typeof camperHealthWriteSchema,
  CamperHealthWrite
> = true
const _demographicsRead: SchemaMatches<
  typeof demographicsReadSchema,
  Demographics
> = true
const _demographicsWrite: SchemaMatches<
  typeof demographicsWriteSchema,
  DemographicsWrite
> = true
const _parentContact: SchemaMatches<
  typeof parentContactReadSchema,
  ParentContact
> = true
const _registrationRead: SchemaMatches<
  typeof registrationReadSchema,
  Registration
> = true
const _registrationWrite: SchemaMatches<
  typeof registrationWriteSchema,
  RegistrationWrite
> = true
const _paymentRead: SchemaMatches<typeof paymentReadSchema, Payment> = true
const _paymentWrite: SchemaMatches<typeof paymentWriteSchema, PaymentWrite> =
  true
const _paymentItem: SchemaMatches<
  ReturnType<typeof paymentItemSchemaFor>,
  PaymentItem
> = true
const _paymentDiscount: SchemaMatches<
  ReturnType<typeof paymentDiscountSchemaFor>,
  PaymentDiscount
> = true
const _campCreditRead: SchemaMatches<typeof campCreditReadSchema, CampCredit> =
  true
const _campCreditWrite: SchemaMatches<
  typeof campCreditWriteSchema,
  CampCreditWrite
> = true
const _campYearRead: SchemaMatches<typeof campYearReadSchema, CampYear> = true
const _campYearWrite: SchemaMatches<typeof campYearWriteSchema, CampYearWrite> =
  true
const _adminRead: SchemaMatches<typeof adminReadSchema, Admin> = true
const _adminWrite: SchemaMatches<typeof adminWriteSchema, AdminWrite> = true
const _adminAuditLogEntryRead: SchemaMatches<
  typeof adminAuditLogEntryReadSchema,
  AdminAuditLogEntry
> = true
const _adminAuditLogEntryWrite: SchemaMatches<
  typeof adminAuditLogEntryWriteSchema,
  AdminAuditLogEntryWrite
> = true
const _registrationPayload: SchemaMatches<
  typeof registrationPayloadSchema,
  RegistrationPayload
> = true
const _preRegistrationPayload: SchemaMatches<
  typeof preRegistrationPayloadSchema,
  PreRegistrationInputPayload
> = true
const _manageAdminRequest: SchemaMatches<
  typeof manageAdminRequestSchema,
  ManageAdminRequest
> = true
const _moveCampersOffWaitlistRequest: SchemaMatches<
  typeof moveCampersOffWaitlistRequestSchema,
  MoveCampersOffWaitlistRequest
> = true
/* eslint-enable @typescript-eslint/no-unused-vars */

function paymentItemSchemaFor() {
  return obj("strict", paymentItemShape("read"))
}
function paymentDiscountSchemaFor() {
  return obj("strict", paymentDiscountShape("read"))
}
