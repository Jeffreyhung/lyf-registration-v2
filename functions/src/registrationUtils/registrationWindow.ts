import type {Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {
  CampYear,
  normalizeEmail,
  registrationBypassCollectionPath,
} from "lyf-registration-schemas";

// Camp announces every deadline in Pacific time.
const CAMP_TIME_ZONE = "America/Los_Angeles";

/** The slice of Firestore this check needs, so tests can pass the fake. */
type BypassReader = Pick<Firestore, "collection">;

/** registrationCloseDate as epoch millis, or null when the year has none. */
export function registrationCloseMillis(camp: CampYear | undefined): number | null {
  const ts = camp?.registrationCloseDate;
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

/**
 * Server-side counterpart of the website's registration time gate.
 *
 * The page hides itself after camps/{year}.registrationCloseDate unless the
 * signed-in family has an entry under camps/{year}/private/bypass/emails/,
 * but a client can call createRegistrationSession directly, so the same
 * rule is applied here before anything is written. A year with no close
 * date configured is not gated (legacy documents).
 *
 * @throws HttpsError failed-precondition when registration has closed and
 *   the caller has no bypass entry for that year.
 */
export async function assertRegistrationOpen(
  db: BypassReader,
  campYear: number,
  camp: CampYear | undefined,
  callerEmail: string,
  nowMs: number = Date.now()
): Promise<void> {
  const closeMs = registrationCloseMillis(camp);
  if (closeMs === null || nowMs <= closeMs) return;

  const email = normalizeEmail(callerEmail);
  const bypass = await db
    .collection(registrationBypassCollectionPath(campYear))
    .doc(email)
    .get();
  if (bypass.exists) return;

  const closedOn = new Date(closeMs).toLocaleDateString("en-US", {
    timeZone: CAMP_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  throw new HttpsError(
    "failed-precondition",
    `Registration for LYF Camp ${campYear} closed on ${closedOn}. ` +
      "Please contact lyf@tacl.org if you were told you could still register."
  );
}
