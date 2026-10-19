import {addYears} from "date-fns";
import {fromZonedTime, toZonedTime} from "date-fns-tz";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  CAMP_YEAR_CONFIG_KEYS,
  CAMP_YEAR_DATE_KEYS,
  CAMP_YEAR_DATE_ORDER,
  CAMP_YEAR_FEE_KEYS,
  CAMP_YEAR_TEXT_KEYS,
  CampTrack,
  CampYearConfigInput,
  ManageCampYearRequest,
  ManageCampYearResponse,
  normalizeEmail,
  normalizeEmails,
  SITE_CONFIG_PATH,
} from "lyf-registration-schemas";

import {getFirestoreDb, PROD_DATABASE_ID, TEST_DATABASE_ID} from "../utils";
import {assertAdmin, callableOptions} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";

// Camp runs on Pacific time; "the same date next year" is a calendar shift in
// this zone so a noon PST deadline stays noon PST across DST boundaries.
const CAMP_TIME_ZONE = "America/Los_Angeles";

const MIN_YEAR = 2017;
const MAX_YEAR = 2100;

type CampYearDoc = Record<string, unknown>;

/**
 * The only write path for camps/{year} configuration and config/site.
 * Firestore rules deny every client write to both, so this is where we can:
 *  - restrict edits to the configuration whitelist (never remainingSpots,
 *    which the registration functions own)
 *  - keep registration dates in a sensible order
 *  - roll a year forward by copying the previous one
 *  - append an entry to `adminAuditLog`
 *
 * Unlike the admin roster, camp data exists in both the prod and test
 * databases, so the request's `isTestData` picks which one is written.
 */
export const manageCampYear = onCall<
  ManageCampYearRequest,
  Promise<ManageCampYearResponse>
>(
  callableOptions,
  withSentryCallable("manageCampYear", async (request) => {
    const {email: actorEmail} = await assertAdmin(request, "manageCampYear");
    const actor = normalizeEmail(actorEmail);

    const data = request.data ?? ({} as ManageCampYearRequest);
    const isTestData = data.isTestData === true;
    const db = getFirestoreDb(!isTestData);
    const database = isTestData ? TEST_DATABASE_ID : PROD_DATABASE_ID;

    let target = "";

    await db.runTransaction(async (tx) => {
      const audit = (
        action: ManageCampYearRequest["action"],
        before: CampYearDoc | null,
        after: CampYearDoc | null
      ) => {
        tx.set(db.collection("adminAuditLog").doc(), {
          actor,
          action,
          target,
          database,
          before,
          after,
          at: FieldValue.serverTimestamp(),
        });
      };

      switch (data.action) {
        case "createYear": {
          const year = parseYear(data.year, "year");
          const sourceYear = parseYear(data.sourceYear, "sourceYear");
          if (sourceYear >= year) {
            throw new HttpsError(
              "invalid-argument",
              "sourceYear must be earlier than year"
            );
          }
          target = `camps/${year}`;

          const targetRef = db.collection("camps").doc(String(year));
          const sourceRef = db.collection("camps").doc(String(sourceYear));
          const [targetSnap, sourceSnap] = await Promise.all([
            tx.get(targetRef),
            tx.get(sourceRef),
          ]);
          if (targetSnap.exists) {
            throw new HttpsError("already-exists", `${target} already exists`);
          }
          if (!sourceSnap.exists) {
            throw new HttpsError(
              "not-found",
              `camps/${sourceYear} does not exist to copy from`
            );
          }

          const source = sourceSnap.data() as CampYearDoc;
          const shifted = shiftTimestamps(source, year - sourceYear);
          const overrides = parseConfigInput(data.overrides ?? {});
          const after: CampYearDoc = {
            ...shifted,
            ...overrides,
            name: overrides.name ?? `LYF Camp ${year}`,
            // Fresh year, fresh spots. campSizeCaps may itself be overridden.
            remainingSpots: {...((overrides.campSizeCaps ??
              shifted.campSizeCaps ??
              {}) as Record<string, number>)},
          };
          assertDateOrder(after, new Set(CAMP_YEAR_DATE_KEYS));

          tx.set(targetRef, after);
          audit("createYear", null, after);
          break;
        }

        case "updateYear": {
          const year = parseYear(data.year, "year");
          target = `camps/${year}`;
          const fields = parseConfigInput(data.fields);
          const changedKeys = Object.keys(fields);
          if (changedKeys.length === 0) {
            throw new HttpsError("invalid-argument", "No fields to update");
          }

          const ref = db.collection("camps").doc(String(year));
          const snap = await tx.get(ref);
          if (!snap.exists) {
            throw new HttpsError("not-found", `${target} does not exist`);
          }
          const before = snap.data() as CampYearDoc;
          const after: CampYearDoc = {...before, ...fields};
          assertDateOrder(after, new Set(changedKeys));

          tx.update(ref, fields as {[key: string]: FieldValue | object});
          audit("updateYear", before, after);
          break;
        }

        case "setSiteConfig": {
          target = SITE_CONFIG_PATH;
          const config = data.config ?? {};
          const update: Record<string, number> = {};
          if (config.currentCampYear !== undefined) {
            update.currentCampYear = parseYear(
              config.currentCampYear,
              "currentCampYear"
            );
          }
          if (config.preRegistrationCampYear !== undefined) {
            update.preRegistrationCampYear = parseYear(
              config.preRegistrationCampYear,
              "preRegistrationCampYear"
            );
          }
          if (Object.keys(update).length === 0) {
            throw new HttpsError("invalid-argument", "No config to update");
          }

          const ref = db.doc(SITE_CONFIG_PATH);
          const snap = await tx.get(ref);
          const before = snap.exists ? (snap.data() as CampYearDoc) : null;

          // The pointers must name years that exist, otherwise the website
          // would gate itself closed with "camp not found".
          for (const year of Object.values(update)) {
            const campSnap = await tx.get(
              db.collection("camps").doc(String(year))
            );
            if (!campSnap.exists) {
              throw new HttpsError(
                "failed-precondition",
                `camps/${year} does not exist — create it before pointing ` +
                  "the site at it"
              );
            }
          }

          const after: CampYearDoc = {
            ...(before ?? {}),
            ...update,
            updatedBy: actor,
          };
          tx.set(
            ref,
            {...update, updatedBy: actor, updatedAt: FieldValue.serverTimestamp()},
            {merge: true}
          );
          audit("setSiteConfig", before, after);
          break;
        }

        default:
          throw new HttpsError(
            "invalid-argument",
            `Unknown action: ${(data as {action?: unknown}).action}`
          );
      }
    });

    logger.info(`manageCampYear: ${actor} ${data.action} ${target} (${database})`);
    return {status: "success", action: data.action, target};
  })
);

// ---- Validation helpers ----

function parseYear(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_YEAR ||
    value > MAX_YEAR
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a whole year between ${MIN_YEAR} and ${MAX_YEAR}`
    );
  }
  return value;
}

function parseTimestamp(value: unknown, field: string): Timestamp {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be an ISO-8601 date-time string`
    );
  }
  return Timestamp.fromDate(new Date(value));
}

function parseAmount(value: unknown, field: string, integer: boolean): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a non-negative ${integer ? "whole " : ""}number`
    );
  }
  return value;
}

const CAMP_TRACKS = new Set<string>(Object.values(CampTrack));

/**
 * Turns the JSON payload into Firestore field values, rejecting any key
 * outside CAMP_YEAR_CONFIG_KEYS (so remainingSpots can never arrive here) and
 * any value of the wrong shape.
 */
function parseConfigInput(input: unknown): CampYearDoc {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpsError("invalid-argument", "fields must be an object");
  }
  const allowed = new Set<string>(CAMP_YEAR_CONFIG_KEYS);
  const dateKeys = new Set<string>(CAMP_YEAR_DATE_KEYS);
  const feeKeys = new Set<string>(CAMP_YEAR_FEE_KEYS);
  const textKeys = new Set<string>(CAMP_YEAR_TEXT_KEYS);

  const out: CampYearDoc = {};
  for (const [key, value] of Object.entries(input as CampYearConfigInput)) {
    if (!allowed.has(key)) {
      throw new HttpsError(
        "invalid-argument",
        `${key} is not an editable camp year field`
      );
    }
    // Skip undefined so a form can send its whole state without clearing fields.
    if (value === undefined) continue;

    if (dateKeys.has(key)) {
      out[key] = parseTimestamp(value, key);
    } else if (feeKeys.has(key)) {
      out[key] = parseAmount(value, key, false);
    } else if (textKeys.has(key)) {
      if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `${key} must be a string`);
      }
      out[key] = value.trim();
    } else if (key === "campTotalSizeCap") {
      out[key] = parseAmount(value, key, true);
    } else if (key === "campSizeCaps") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new HttpsError("invalid-argument", "campSizeCaps must be a map");
      }
      const caps: Record<string, number> = {};
      for (const [track, cap] of Object.entries(value as object)) {
        if (!CAMP_TRACKS.has(track)) {
          throw new HttpsError(
            "invalid-argument",
            `campSizeCaps has unknown track ${track}`
          );
        }
        caps[track] = parseAmount(cap, `campSizeCaps.${track}`, true);
      }
      out[key] = caps;
    } else if (key === "registrationBypassEmails") {
      if (!Array.isArray(value) || value.some((e) => typeof e !== "string")) {
        throw new HttpsError(
          "invalid-argument",
          "registrationBypassEmails must be a list of emails"
        );
      }
      out[key] = normalizeEmails(value as string[]);
    }
  }
  return out;
}

/**
 * Checks every pair in CAMP_YEAR_DATE_ORDER where both dates are present and
 * at least one of them is being changed. Pre-existing disorder in fields the
 * caller didn't touch is left alone so unrelated edits aren't blocked.
 */
function assertDateOrder(doc: CampYearDoc, changed: Set<string>) {
  for (const [earlier, later] of CAMP_YEAR_DATE_ORDER) {
    if (!changed.has(earlier) && !changed.has(later)) continue;
    const a = doc[earlier];
    const b = doc[later];
    if (!(a instanceof Timestamp) || !(b instanceof Timestamp)) continue;
    if (a.toMillis() > b.toMillis()) {
      throw new HttpsError(
        "invalid-argument",
        `${earlier} must not be after ${later}`
      );
    }
  }
}

/**
 * Copies a camp year document moving every Timestamp forward by `years`
 * calendar years in Pacific time. Non-date fields are copied as-is; the
 * caller resets remainingSpots afterwards.
 */
function shiftTimestamps(source: CampYearDoc, years: number): CampYearDoc {
  const out: CampYearDoc = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value instanceof Timestamp ? shiftTimestamp(value, years) : value;
  }
  return out;
}

export function shiftTimestamp(ts: Timestamp, years: number): Timestamp {
  const zoned = toZonedTime(ts.toDate(), CAMP_TIME_ZONE);
  const shifted = fromZonedTime(addYears(zoned, years), CAMP_TIME_ZONE);
  return Timestamp.fromDate(shifted);
}
