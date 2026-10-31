import {addYears} from "date-fns";
import {fromZonedTime, toZonedTime} from "date-fns-tz";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {
  CAMP_YEAR_CONFIG_KEYS,
  CAMP_YEAR_DATE_KEYS,
  CAMP_YEAR_DATE_ORDER,
  CAMP_YEAR_FEE_KEYS,
  CAMP_YEAR_FLAG_KEYS,
  CAMP_YEAR_IMAGE_URL_KEYS,
  CAMP_YEAR_TEXT_KEYS,
  CampTrack,
  CampYearConfigInput,
  isAllowedImageUrl,
  isMailchimpListId,
  MAX_IMAGE_URL_LENGTH,
  normalizeEmails,
} from "lyf-registration-schemas";

// Input validation for the manageCampYear callable, kept free of Firestore
// and function-runtime imports so it can be unit tested on its own. Every
// value that reaches camps/{year} from the dashboard passes through here.

// Camp runs on Pacific time; "the same date next year" is a calendar shift in
// this zone so a noon PST deadline stays noon PST across DST boundaries.
const CAMP_TIME_ZONE = "America/Los_Angeles";

const MIN_YEAR = 2017;
const MAX_YEAR = 2100;

export type CampYearDoc = Record<string, unknown>;


export function parseYear(value: unknown, field: string): number {
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

export function parseTimestamp(value: unknown, field: string): Timestamp {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be an ISO-8601 date-time string`
    );
  }
  return Timestamp.fromDate(new Date(value));
}

export function parseAmount(value: unknown, field: string, integer: boolean): number {
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
 * Image URLs end up in an <img src> on the public site and in every
 * confirmation email, so only absolute https URLs without credentials and
 * within MAX_IMAGE_URL_LENGTH are stored (isAllowedImageUrl is the single
 * definition, shared with the website). Empty clears the field so the
 * bundled fallback image is used again.
 */
export function parseImageUrl(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }
  const url = value.trim();
  if (url === "") return url;
  if (!isAllowedImageUrl(url)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be an https:// URL without embedded credentials, at ` +
        `most ${MAX_IMAGE_URL_LENGTH} characters`
    );
  }
  return url;
}

/**
 * The Mailchimp audience id ends up in Mailchimp API URLs, so only the id
 * shape is stored (isMailchimpListId is shared with the website). Empty
 * clears the field, after which registrations fall back to the general list.
 */
export function parseMailchimpListId(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }
  const id = value.trim();
  if (id === "") return id;
  if (!isMailchimpListId(id)) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a Mailchimp audience id (lowercase letters and ` +
        "digits, e.g. 2bd94e4a2c; find it under Audience → Settings → " +
        "Audience name and defaults)"
    );
  }
  return id;
}

/**
 * Turns the JSON payload into Firestore field values, rejecting any key
 * outside CAMP_YEAR_CONFIG_KEYS (so remainingSpots can never arrive here) and
 * any value of the wrong shape.
 */
export function parseConfigInput(input: unknown): CampYearDoc {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpsError("invalid-argument", "fields must be an object");
  }
  const allowed = new Set<string>(CAMP_YEAR_CONFIG_KEYS);
  const dateKeys = new Set<string>(CAMP_YEAR_DATE_KEYS);
  const feeKeys = new Set<string>(CAMP_YEAR_FEE_KEYS);
  const textKeys = new Set<string>(CAMP_YEAR_TEXT_KEYS);
  const imageUrlKeys = new Set<string>(CAMP_YEAR_IMAGE_URL_KEYS);
  const flagKeys = new Set<string>(CAMP_YEAR_FLAG_KEYS);

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
    } else if (imageUrlKeys.has(key)) {
      out[key] = parseImageUrl(value, key);
    } else if (key === "mailchimpListId") {
      out[key] = parseMailchimpListId(value, key);
    } else if (textKeys.has(key)) {
      if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `${key} must be a string`);
      }
      out[key] = value.trim();
    } else if (flagKeys.has(key)) {
      if (typeof value !== "boolean") {
        throw new HttpsError("invalid-argument", `${key} must be true or false`);
      }
      out[key] = value;
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
export function assertDateOrder(doc: CampYearDoc, changed: Set<string>) {
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
export function shiftTimestamps(source: CampYearDoc, years: number): CampYearDoc {
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
