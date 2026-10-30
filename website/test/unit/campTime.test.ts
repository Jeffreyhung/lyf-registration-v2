import dayjs from "dayjs"
import type { Timestamp } from "firebase/firestore"

import {
  CAMP_TIME_ZONE,
  FAR_FUTURE,
  formatCampDate,
  formatCampDateWithYear,
  formatCampMonthYear,
  formatCampTime,
  timestampToCampTime,
} from "@utils/campTime"

// Only toDate() is read, so a stand-in is enough; a real Timestamp needs the
// Firestore client.
const fakeTimestamp = (iso: string) =>
  ({ toDate: () => new Date(iso) }) as unknown as Timestamp

// 03:30 UTC on 1 Feb is still the evening of 31 Jan in California.
const lateJanuary = "2026-02-01T03:30:00Z"

describe("campTime", () => {
  it("formats everything in Pacific time", () => {
    expect(CAMP_TIME_ZONE).toBe("America/Los_Angeles")
  })

  it("uses a far-future sentinel for 'no date configured'", () => {
    expect(FAR_FUTURE.year()).toBe(2999)
    expect(FAR_FUTURE.isAfter(dayjs())).toBe(true)
  })

  describe("timestampToCampTime", () => {
    it("returns null for a missing or malformed timestamp", () => {
      expect(timestampToCampTime(null)).toBeNull()
      expect(timestampToCampTime(undefined)).toBeNull()
      expect(timestampToCampTime({} as unknown as Timestamp)).toBeNull()
    })

    it("converts a Firestore timestamp to camp time", () => {
      const converted = timestampToCampTime(fakeTimestamp(lateJanuary))
      expect(converted?.format("YYYY-MM-DD HH:mm")).toBe("2026-01-31 19:30")
    })
  })

  describe("formatters", () => {
    const d = dayjs(lateJanuary)

    it("formatCampDate", () => {
      expect(formatCampDate(d)).toBe("January 31")
    })

    it("formatCampDateWithYear", () => {
      expect(formatCampDateWithYear(d)).toBe("January 31, 2026")
    })

    it("formatCampTime", () => {
      expect(formatCampTime(d)).toBe("7:30 PM Pacific Time")
    })

    it("formatCampMonthYear", () => {
      expect(formatCampMonthYear(d)).toBe("January 2026")
    })

    it("follows daylight saving time", () => {
      expect(formatCampTime(dayjs("2026-07-04T19:00:00Z"))).toBe(
        "12:00 PM Pacific Time"
      )
    })
  })
})
