import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {
  AdminRole,
  Capability,
  normalizeEmail,
  resolveAdminRole,
  roleHasCapability,
  rolesWithCapability,
} from "lyf-registration-schemas";

import {db} from "../utils";

// Comma-separated list of origins Stripe may redirect back to. Configured per
// environment so the staging host can be added without a code change.
// Localhost is only a legitimate target when running in the emulator
// (FUNCTIONS_EMULATOR is set by the Firebase CLI).
const ALLOWED_REDIRECT_ORIGINS = [
  ...(process.env.ALLOWED_REDIRECT_ORIGINS ?? "https://lyf-registration.tacl.org")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  ...(process.env.FUNCTIONS_EMULATOR === "true" ?
    ["http://localhost:8000", "http://localhost:9000"] :
    []),
];

/**
 * Shared options for every onCall function.
 *
 * `invoker: "public"` makes the deploy grant allUsers the Cloud Run invoker
 * role. Callables must be reachable anonymously at the HTTP layer — Firebase
 * Auth is verified inside the function (assertAdmin / request.auth), not by
 * Cloud Run IAM. Without it the browser gets an opaque "internal" error.
 */
export const callableOptions = {
  cors: true,
  invoker: "public" as const,
};

/**
 * The website's own origins — the only pages that should ever call the
 * admin callables from a browser. Same list Stripe may redirect back to, so
 * adding a host is one environment variable.
 */
export const SITE_ORIGINS: readonly string[] = ALLOWED_REDIRECT_ORIGINS;

/**
 * Options for callables that only the admin dashboard uses (manageAdmin,
 * manageCampYear, moveCampersOffWaitlist, issueStripeRefund).
 *
 * CORS is limited to SITE_ORIGINS, so a page on any other origin cannot make
 * a browser call these functions even with a signed-in admin's session. This
 * is defence in depth, not the access control: a non-browser client can set
 * any Origin header, and the real gate remains assertAdmin (Firebase Auth +
 * the admins/ roster) inside each function. To bind calls to the genuine
 * web app itself, enable Firebase App Check and add `enforceAppCheck: true`
 * here once the site initialises it.
 */
export const adminCallableOptions = {
  cors: [...SITE_ORIGINS],
  invoker: "public" as const,
};

/**
 * Looks up the caller's admin role from the `admins` Firestore collection.
 * Fails closed: a missing doc, a disabled admin, or an unknown/missing role
 * value all resolve to null.
 */
async function getCallerAdminRole(
  request: CallableRequest
): Promise<{email: string; role: AdminRole | null}> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const email = request.auth.token.email;
  if (!email) {
    throw new HttpsError("unauthenticated", "No email on auth token");
  }

  const adminDoc = await db
    .collection("admins")
    .doc(normalizeEmail(email))
    .get();

  if (!adminDoc.exists || adminDoc.data()?.disabled === true) {
    return {email, role: null};
  }

  return {email, role: resolveAdminRole(adminDoc.data()?.role)};
}

/**
 * Verifies that the caller is authenticated and has an admin role granting
 * the given capability (see ROLE_CAPABILITIES in the schemas package).
 *
 * @throws HttpsError with "unauthenticated" if not signed in
 * @throws HttpsError with "permission-denied" if not an admin or the caller's
 *   role lacks the capability
 */
export async function assertAdmin(
  request: CallableRequest,
  capability: Capability
): Promise<{email: string; role: AdminRole}> {
  const {email, role} = await getCallerAdminRole(request);

  if (!role) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to perform this action"
    );
  }

  if (!roleHasCapability(role, capability)) {
    throw new HttpsError(
      "permission-denied",
      `Your role does not have permission to perform this action ` +
        `(requires one of: ${rolesWithCapability(capability).join(", ")})`
    );
  }

  return {email, role};
}

/**
 * Validates that a redirect URL belongs to an allowed origin.
 * Prevents open-redirect attacks via Stripe checkout URLs.
 */
export function validateRedirectUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    if (!ALLOWED_REDIRECT_ORIGINS.includes(origin)) {
      throw new HttpsError(
        "invalid-argument",
        `Redirect URL origin "${origin}" is not allowed`
      );
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("invalid-argument", "Invalid redirect URL");
  }
}

/**
 * Validates that the caller's authenticated email matches or is included
 * in a set of expected emails. Used to bind registration payloads to the
 * caller's identity.
 */
export function assertCallerEmailInList(
  authEmail: string,
  emails: string[]
): void {
  const normalizedAuth = normalizeEmail(authEmail);
  const normalizedEmails = emails.map(normalizeEmail);
  if (!normalizedEmails.includes(normalizedAuth)) {
    throw new HttpsError(
      "permission-denied",
      "Your authenticated email does not match the provided parent emails"
    );
  }
}

/**
 * Validates that a dollar amount is a positive finite integer.
 * Used for donation and refund amounts.
 */
export function validateDollarAmount(
  amount: number,
  fieldName: string,
  maxCents = 1_000_000
): void {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > maxCents
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a positive integer up to ${maxCents}`
    );
  }
}

/**
 * True when the caller is an admin whose role grants the capability.
 * Never throws for a non-admin; use assertAdmin to enforce.
 */
export async function callerHasCapability(
  request: CallableRequest,
  capability: Capability
): Promise<boolean> {
  if (!request.auth?.token?.email) return false;

  const {role} = await getCallerAdminRole(request);
  return roleHasCapability(role, capability);
}

/**
 * Resolves whether the caller is allowed to use test data.
 * Only admins whose role grants the createTestData capability may set
 * isTestData=true; everyone else is silently forced to production mode.
 */
export async function resolveTestDataFlag(
  request: CallableRequest,
  requestedIsTestData: boolean
): Promise<boolean> {
  if (!requestedIsTestData) return false;
  return callerHasCapability(request, "createTestData");
}

/**
 * Resolves whether the caller may force every camper in the request onto the
 * waitlist. This is a testing aid, so it is gated the same way as test data:
 * a non-admin's `forceWaitlist: true` is silently ignored. Honouring it for
 * everyone let a caller pad a request with waitlisted (unpaid) campers that
 * still counted toward the sibling discount.
 */
export async function resolveForceWaitlistFlag(
  request: CallableRequest,
  requestedForceWaitlist: boolean
): Promise<boolean> {
  if (!requestedForceWaitlist) return false;
  return callerHasCapability(request, "createTestData");
}

/**
 * Upper bounds on list fields in a registration payload. The form never
 * produces anything near these; they exist so a hand-crafted request cannot
 * create unbounded campers/registrations in one call.
 */
export const MAX_PARENTS_PER_REGISTRATION = 10;
export const MAX_CAMPERS_PER_REGISTRATION = 10;

/**
 * Validates the shape of the list fields in a registration payload before
 * anything is written. Every entry in `campers` becomes a camper document
 * and a registration, so the arrays must be real, non-empty, bounded, and
 * `demographics` must line up with `campers` index-for-index.
 */
export function validateRegistrationPayloadShape(payload: {
  parents?: unknown;
  campers?: unknown;
  demographics?: unknown;
}): void {
  const {parents, campers, demographics} = payload;

  if (!Array.isArray(parents) || parents.length === 0) {
    throw new HttpsError("invalid-argument", "At least one parent is required");
  }
  if (parents.length > MAX_PARENTS_PER_REGISTRATION) {
    throw new HttpsError(
      "invalid-argument",
      `At most ${MAX_PARENTS_PER_REGISTRATION} parents may be submitted`
    );
  }

  if (!Array.isArray(campers) || campers.length === 0) {
    throw new HttpsError("invalid-argument", "At least one camper is required");
  }
  if (campers.length > MAX_CAMPERS_PER_REGISTRATION) {
    throw new HttpsError(
      "invalid-argument",
      `At most ${MAX_CAMPERS_PER_REGISTRATION} campers may be registered at once`
    );
  }

  if (!Array.isArray(demographics) || demographics.length !== campers.length) {
    throw new HttpsError(
      "invalid-argument",
      "demographics must contain one entry per camper"
    );
  }
}
