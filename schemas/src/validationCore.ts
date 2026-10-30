/**
 * Building blocks for the runtime validators in validation.ts: the error type
 * every validator throws, the structural checks for Firestore SDK values, and
 * the glue that turns a zod schema into the `validateX` / `safeValidateX`
 * pair.
 *
 * Nothing in here imports a Firestore SDK at runtime. The client SDK
 * ("firebase/firestore") and the admin SDK ("firebase-admin/firestore") ship
 * distinct classes for Timestamp, DocumentReference and FieldValue, and this
 * package is consumed by both, so every check is structural.
 */
import { z } from "zod"

import type { TimestampLike } from "./admin"

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type SchemaValidationIssue = {
  /** Dotted path to the offending value, e.g. `campers[1].grade`; `(root)` for the input itself. */
  path: string
  message: string
}

/**
 * Thrown by every `validateX` function. `issues` lists each problem with a
 * readable path; `message` repeats them so logs and HttpsError messages are
 * useful without unpacking the error.
 */
export class SchemaValidationError extends Error {
  readonly issues: ReadonlyArray<SchemaValidationIssue>
  /** Which validator produced the error, e.g. "Registration write". */
  readonly label: string

  constructor(label: string, issues: ReadonlyArray<SchemaValidationIssue>) {
    super(formatValidationMessage(label, issues))
    this.name = "SchemaValidationError"
    this.label = label
    this.issues = issues
    // Keep `instanceof` working when the package is compiled to ES5-ish targets.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function formatValidationMessage(
  label: string,
  issues: ReadonlyArray<SchemaValidationIssue>
): string {
  const count = issues.length
  const details = issues.map((i) => `${i.path}: ${i.message}`).join("; ")
  return `Invalid ${label} (${count} issue${
    count === 1 ? "" : "s"
  }): ${details}`
}

export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(root)"
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`
    const key = String(segment)
    return acc === "" ? key : `${acc}.${key}`
  }, "")
}

/**
 * Flatten zod issues into `{path, message}` pairs.
 *
 * Unions are the one place zod's own output is unhelpful ("Invalid input").
 * Our write schemas are `value | FieldValue sentinel` unions, so for a union
 * failure we surface the issues of the branch that got furthest (deepest
 * path), falling back to the first branch — which is always the real value
 * schema — instead of the generic union message.
 */
export function flattenZodIssues(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  prefix: ReadonlyArray<PropertyKey> = []
): SchemaValidationIssue[] {
  const out: SchemaValidationIssue[] = []
  for (const issue of issues) {
    const path = [...prefix, ...issue.path]
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      const branch = pickUnionBranch(issue.errors)
      // Nested union issue paths are relative to the union itself.
      out.push(...flattenZodIssues(branch, path))
      continue
    }
    out.push({ path: formatIssuePath(path), message: issue.message })
  }
  return out
}

function pickUnionBranch(
  branches: ReadonlyArray<ReadonlyArray<z.core.$ZodIssue>>
): ReadonlyArray<z.core.$ZodIssue> {
  let best = branches[0]
  let bestDepth = maxDepth(best)
  for (const branch of branches.slice(1)) {
    const depth = maxDepth(branch)
    if (depth > bestDepth) {
      best = branch
      bestDepth = depth
    }
  }
  return best
}

function maxDepth(issues: ReadonlyArray<z.core.$ZodIssue>): number {
  return issues.reduce((max, i) => Math.max(max, i.path.length), 0)
}

// ---------------------------------------------------------------------------
// Structural checks for Firestore SDK values
// ---------------------------------------------------------------------------

/**
 * The kinds of FieldValue sentinel both SDKs can produce. `unknown` is a value
 * that is recognisably a sentinel (constructor name) whose kind could not be
 * determined.
 */
export type FieldValueKind =
  | "serverTimestamp"
  | "arrayUnion"
  | "arrayRemove"
  | "increment"
  | "delete"
  | "unknown"

// Client SDK (firebase@10, @firebase/firestore): every sentinel is an instance
// of a `*FieldValueImpl` class carrying an own `_methodName` property with one
// of these values. The property survives minification (it is a string
// property, not an identifier), which is why it is checked before the
// constructor name.
const CLIENT_METHOD_NAMES: Record<string, FieldValueKind> = {
  serverTimestamp: "serverTimestamp",
  arrayUnion: "arrayUnion",
  arrayRemove: "arrayRemove",
  increment: "increment",
  deleteField: "delete",
}

// Admin SDK (firebase-admin@12 / @google-cloud/firestore@7): sentinels are
// `*Transform` subclasses of FieldValue exposing a `methodName` getter that
// returns "FieldValue.<method>".
const ADMIN_METHOD_NAMES: Record<string, FieldValueKind> = {
  "FieldValue.serverTimestamp": "serverTimestamp",
  "FieldValue.arrayUnion": "arrayUnion",
  "FieldValue.arrayRemove": "arrayRemove",
  "FieldValue.increment": "increment",
  "FieldValue.delete": "delete",
}

// Last resort when neither property is present (e.g. a future SDK renames
// them): the class names used by both SDKs today.
const CONSTRUCTOR_NAME =
  /^(ServerTimestamp|ArrayUnion|ArrayRemove|NumericIncrement|Delete)(FieldValueImpl|Transform)$/

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Classify a Firestore `FieldValue` sentinel (`FieldValue.serverTimestamp()`,
 * `arrayUnion(...)`, `increment(...)`, `deleteField()` …) from either SDK, or
 * return null when the value is not a sentinel.
 */
export function getFieldValueKind(value: unknown): FieldValueKind | null {
  if (!isObjectLike(value)) return null

  const clientName = value._methodName
  if (typeof clientName === "string" && clientName in CLIENT_METHOD_NAMES) {
    return CLIENT_METHOD_NAMES[clientName]
  }

  const adminName = value.methodName
  if (typeof adminName === "string" && adminName in ADMIN_METHOD_NAMES) {
    return ADMIN_METHOD_NAMES[adminName]
  }

  const ctorName = value.constructor?.name
  if (typeof ctorName === "string") {
    const match = CONSTRUCTOR_NAME.exec(ctorName)
    if (match) {
      const kind = match[1]
      if (kind === "NumericIncrement") return "increment"
      if (kind === "Delete") return "delete"
      return (kind.charAt(0).toLowerCase() + kind.slice(1)) as FieldValueKind
    }
  }

  // Recognisably a FieldValue (admin SDK exposes methodName on every
  // transform; client exposes _methodName) but of a kind we don't know.
  if (
    (typeof clientName === "string" && clientName.length > 0) ||
    (typeof adminName === "string" && adminName.startsWith("FieldValue."))
  ) {
    return "unknown"
  }

  return null
}

/** True for a FieldValue sentinel from either SDK. */
export function isFieldValueSentinel(value: unknown): boolean {
  return getFieldValueKind(value) !== null
}

/**
 * True for a Firestore Timestamp from either SDK (and anything else matching
 * {@link TimestampLike}). The admin SDK stores `_seconds`/`_nanoseconds` and
 * exposes getters; the client SDK stores them as own properties — reading
 * `value.seconds` works for both.
 */
export function isTimestampLike(value: unknown): value is TimestampLike {
  if (!isObjectLike(value)) return false
  return (
    typeof value.seconds === "number" &&
    Number.isInteger(value.seconds) &&
    typeof value.nanoseconds === "number" &&
    Number.isInteger(value.nanoseconds) &&
    typeof value.toDate === "function" &&
    typeof value.toMillis === "function"
  )
}

/** Minimal structural shape shared by client and admin `DocumentReference`. */
export type DocumentReferenceLike = { id: string; path: string }

/**
 * True for a `DocumentReference` from either SDK: an object whose `path` is a
 * relative document path (even number of non-empty segments) ending in `id`.
 */
export function isDocumentReferenceLike(
  value: unknown
): value is DocumentReferenceLike {
  if (!isObjectLike(value)) return false
  const { id, path } = value
  if (typeof id !== "string" || id.length === 0) return false
  if (typeof path !== "string" || path.length === 0) return false
  const segments = path.split("/")
  if (segments.length < 2 || segments.length % 2 !== 0) return false
  if (segments.some((s) => s.length === 0)) return false
  return segments[segments.length - 1] === id
}

// ---------------------------------------------------------------------------
// Validator plumbing
// ---------------------------------------------------------------------------

export type ValidateOptions = {
  /**
   * Accept keys the schema does not know about (at every nesting level)
   * instead of rejecting them. Off by default so typos such as `shirtsize`
   * fail loudly; turn it on only for legacy documents that carry fields the
   * types no longer describe.
   */
  allowUnknownKeys?: boolean
}

export type SafeValidateResult<T> =
  | { success: true; data: T }
  | { success: false; error: SchemaValidationError }

export type Validator<T> = (input: unknown, options?: ValidateOptions) => T
export type SafeValidator<T> = (
  input: unknown,
  options?: ValidateOptions
) => SafeValidateResult<T>

/** How unknown keys are treated when a schema is built. */
export type UnknownKeys = "reject" | "allow"

export function unknownKeysFrom(options?: ValidateOptions): UnknownKeys {
  return options?.allowUnknownKeys ? "allow" : "reject"
}

/**
 * Build a `validate` / `safeValidate` pair from a schema factory. The factory
 * is called at most once per unknown-key mode and the result cached, so
 * validators are cheap to call in hot paths.
 */
export function makeValidators<T>(
  label: string,
  build: (unknownKeys: UnknownKeys) => z.ZodType
): { validate: Validator<T>; safeValidate: SafeValidator<T> } {
  const cache = new Map<UnknownKeys, z.ZodType>()
  const schemaFor = (mode: UnknownKeys): z.ZodType => {
    let schema = cache.get(mode)
    if (!schema) {
      schema = build(mode)
      cache.set(mode, schema)
    }
    return schema
  }

  const safeValidate: SafeValidator<T> = (input, options) => {
    const result = schemaFor(unknownKeysFrom(options)).safeParse(input)
    if (result.success) return { success: true, data: result.data as T }
    return {
      success: false,
      error: new SchemaValidationError(
        label,
        flattenZodIssues(result.error.issues)
      ),
    }
  }

  const validate: Validator<T> = (input, options) => {
    const result = safeValidate(input, options)
    if (result.success) return result.data
    throw result.error
  }

  return { validate, safeValidate }
}
