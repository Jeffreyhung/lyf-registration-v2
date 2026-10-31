import { Timestamp } from "firebase/firestore"

import { CampTrack, CampYear } from "../src/camp"
import {
  getCampTrack,
  getCampTracksFromCamp,
  getRegistrationPrice,
  isAllowedImageUrl,
  isMailchimpListId,
  MAX_IMAGE_URL_LENGTH,
  normalizeEmail,
  normalizeEmails,
} from "../src/utils"

describe("isMailchimpListId", () => {
  it("accepts a Mailchimp audience id", () => {
    expect(isMailchimpListId("2bd94e4a2c")).toBe(true)
    expect(isMailchimpListId("be387aca9f")).toBe(true)
  })

  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["uppercase", "2BD94E4A2C"],
    ["untrimmed", " 2bd94e4a2c"],
    ["a URL", "https://us7.admin.mailchimp.com/lists/"],
    ["path characters", "2bd94e4a2c/members"],
    ["too long", "a".repeat(33)],
    ["not a string", 42],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isMailchimpListId(value)).toBe(false)
  })
})

describe("isAllowedImageUrl", () => {
  it("accepts an absolute https URL", () => {
    expect(isAllowedImageUrl("https://mcusercontent.com/a/b.jpg")).toBe(true)
    expect(isAllowedImageUrl("https://example.com/i.png?w=600&v=2")).toBe(true)
  })

  it.each([
    ["http", "http://example.com/a.jpg"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["blob:", "blob:https://example.com/uuid"],
    ["relative", "/a.jpg"],
    ["protocol-relative", "//example.com/a.jpg"],
    ["credentials", "https://u:p@example.com/a.jpg"],
    ["username only", "https://u@example.com/a.jpg"],
    ["untrimmed", " https://example.com/a.jpg"],
    ["empty", ""],
    ["too long", `https://example.com/${"a".repeat(MAX_IMAGE_URL_LENGTH)}`],
    ["not a string", 42],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isAllowedImageUrl(value)).toBe(false)
  })

  it("allows a URL exactly at the length limit", () => {
    const prefix = "https://example.com/"
    expect(
      isAllowedImageUrl(
        prefix + "a".repeat(MAX_IMAGE_URL_LENGTH - prefix.length)
      )
    ).toBe(true)
  })
})

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Parent@Example.COM ")).toBe("parent@example.com")
  })

  it("leaves an already-canonical email untouched", () => {
    expect(normalizeEmail("parent@example.com")).toBe("parent@example.com")
  })
})

describe("normalizeEmails", () => {
  it("drops empty, null and undefined entries", () => {
    expect(normalizeEmails(["a@x.com", "", null, undefined])).toEqual([
      "a@x.com",
    ])
  })

  it("dedupes addresses that only differ by case or whitespace", () => {
    expect(
      normalizeEmails(["A@x.com", "a@x.com ", " a@X.COM", "b@x.com"])
    ).toEqual(["a@x.com", "b@x.com"])
  })

  it("preserves first-seen order", () => {
    expect(normalizeEmails(["z@x.com", "a@x.com", "Z@x.com"])).toEqual([
      "z@x.com",
      "a@x.com",
    ])
  })

  it("returns an empty list for no usable input", () => {
    expect(normalizeEmails([])).toEqual([])
    expect(normalizeEmails([null, undefined, ""])).toEqual([])
  })
})

describe("getCampTrack", () => {
  it.each([1, 5, 7])("puts grade %i in the younger track", (grade) => {
    expect(getCampTrack(grade)).toBe(CampTrack.YOUNGER)
  })

  it.each([8, 9, 12])("puts grade %i in the older track", (grade) => {
    expect(getCampTrack(grade)).toBe(CampTrack.OLDER)
  })
})

describe("getRegistrationPrice", () => {
  const lateDate = Timestamp.fromMillis(Date.UTC(2026, 5, 1))
  const beforeLate = lateDate.toMillis() - 1
  const afterLate = lateDate.toMillis() + 1

  const campYear: CampYear = {
    registrationFee: 700,
    registrationLateFee: 800,
    registrationLateDate: lateDate,
  }

  it("charges the regular fee before the late date", () => {
    expect(getRegistrationPrice(campYear, beforeLate)).toBe(700)
  })

  it("charges the regular fee exactly at the late date", () => {
    expect(getRegistrationPrice(campYear, lateDate.toMillis())).toBe(700)
  })

  it("charges the late fee after the late date", () => {
    expect(getRegistrationPrice(campYear, afterLate)).toBe(800)
  })

  it("falls back to the regular fee when no late fee is configured", () => {
    expect(
      getRegistrationPrice(
        { ...campYear, registrationLateFee: undefined },
        afterLate
      )
    ).toBe(700)
  })

  it("never charges late when no late date is configured", () => {
    expect(
      getRegistrationPrice(
        { ...campYear, registrationLateDate: undefined },
        afterLate
      )
    ).toBe(700)
  })

  it("returns 0 when no fee is configured at all", () => {
    expect(getRegistrationPrice({}, afterLate)).toBe(0)
  })

  it("defaults to the current time", () => {
    const pastLateDate: CampYear = {
      registrationFee: 700,
      registrationLateFee: 800,
      registrationLateDate: Timestamp.fromMillis(Date.now() - 60_000),
    }
    expect(getRegistrationPrice(pastLateDate)).toBe(800)
  })
})

describe("getCampTracksFromCamp", () => {
  it("returns an entry per configured track with its cap and remaining spots", () => {
    const tracks = getCampTracksFromCamp({
      campSizeCaps: { [CampTrack.YOUNGER]: 60, [CampTrack.OLDER]: 40 },
      remainingSpots: { [CampTrack.YOUNGER]: 12, [CampTrack.OLDER]: 0 },
    })

    expect(tracks).toEqual([
      { track: CampTrack.YOUNGER, cap: 60, remainingSpots: 12 },
      { track: CampTrack.OLDER, cap: 40, remainingSpots: 0 },
    ])
  })

  it("bottoms remaining spots out at zero", () => {
    const [younger] = getCampTracksFromCamp({
      campSizeCaps: { [CampTrack.YOUNGER]: 60, [CampTrack.OLDER]: 40 },
      remainingSpots: { [CampTrack.YOUNGER]: -3, [CampTrack.OLDER]: 5 },
    })
    expect(younger.remainingSpots).toBe(0)
  })

  it("treats a track with no remaining-spots entry as full", () => {
    const tracks = getCampTracksFromCamp({
      campSizeCaps: { [CampTrack.YOUNGER]: 60, [CampTrack.OLDER]: 40 },
      remainingSpots: { [CampTrack.YOUNGER]: 10 } as CampYear["remainingSpots"],
    })
    expect(
      tracks.find((t) => t.track === CampTrack.OLDER)?.remainingSpots
    ).toBe(0)
  })

  it("returns nothing when caps or remaining spots are missing", () => {
    expect(getCampTracksFromCamp({})).toEqual([])
    expect(
      getCampTracksFromCamp({
        campSizeCaps: { [CampTrack.YOUNGER]: 60, [CampTrack.OLDER]: 40 },
      })
    ).toEqual([])
    expect(
      getCampTracksFromCamp({
        remainingSpots: { [CampTrack.YOUNGER]: 1, [CampTrack.OLDER]: 1 },
      })
    ).toEqual([])
  })
})
