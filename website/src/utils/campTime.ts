import dayjs, { Dayjs } from "dayjs"
import utc from "dayjs/plugin/utc"
import timezone from "dayjs/plugin/timezone"
import type { Timestamp } from "firebase/firestore"

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Camp runs on Pacific time and every deadline is announced in it, so dates
 * are formatted in this zone no matter where the visitor is.
 */
export const CAMP_TIME_ZONE = "America/Los_Angeles"

/** A sentinel for "no date configured": gates compare against it as never-open. */
export const FAR_FUTURE = dayjs("2999-12-31T00:00:00Z")

/** Firestore Timestamp (or nothing) to a Dayjs in camp time, or null. */
export function timestampToCampTime(ts: Timestamp | undefined | null): Dayjs | null {
  if (!ts || typeof ts.toDate !== "function") return null
  return dayjs(ts.toDate()).tz(CAMP_TIME_ZONE)
}

/** "January 31" */
export const formatCampDate = (d: Dayjs) => d.tz(CAMP_TIME_ZONE).format("MMMM D")

/** "January 31, 2026" */
export const formatCampDateWithYear = (d: Dayjs) =>
  d.tz(CAMP_TIME_ZONE).format("MMMM D, YYYY")

/** "12:00 PM Pacific Time" */
export const formatCampTime = (d: Dayjs) =>
  `${d.tz(CAMP_TIME_ZONE).format("h:mm A")} Pacific Time`

/** "January 2026" */
export const formatCampMonthYear = (d: Dayjs) =>
  d.tz(CAMP_TIME_ZONE).format("MMMM YYYY")
