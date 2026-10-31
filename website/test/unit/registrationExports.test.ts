import dayjs from "dayjs"
import type { DocumentReference } from "firebase/firestore"
import { RegistrationStatus } from "lyf-registration-schemas"

import {
  QUICK_EXPORTS,
  camperName,
  collectContacts,
  exportFileName,
  matchCampersByName,
  namedCampersTable,
} from "@components/Admin/registrationExports"
import type { RegistrationData } from "@hooks/useRegistrations"

// The exports never touch the reference, so an empty stand-in is enough.
const registrationRef = {} as DocumentReference

const reg = (overrides: Partial<RegistrationData>): RegistrationData => ({
  registrationRef,
  registrationYear: 2026,
  familyId: "family",
  parents: [],
  status: RegistrationStatus.ACTIVE,
  ...overrides,
})

const ada = reg({
  camperName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  birthDate: "2012-03-05",
  grade: 7,
  gender: ["Female"],
  pronouns: "she/her",
  shirtSize: "M",
  isPreRegistered: true,
  isReturning: false,
  medicalConditions: "Asthma",
  dietAndFoodAllergies: "Peanuts",
  cabinPreference: "With Bea",
  additionalNotes: "Arrives late",
  internalNotes: "Scholarship",
  parents: [
    { firstName: "Grace", lastName: "Hopper", email: "Grace@example.com" },
    { firstName: "Alan", lastName: "Turing", email: "alan@example.com" },
  ],
  familyData: {
    street: "1 Main St",
    suite: "Apt 2",
    city: "Pasadena",
    state: "CA",
    zip: "91101",
    country: "US",
    emails: ["grace@example.com", "shared@example.com"],
  },
})

// Legacy row: only camperName, a parent with no name on file, waitlisted.
const bea = reg({
  camperName: "Bea Smith",
  status: RegistrationStatus.WAITLIST,
  grade: 9,
  isPreRegistered: true,
  parents: [{ email: "bea.parent@example.com" }],
  familyData: { emails: ["bea.parent@example.com", "Shared@example.com"] },
})

const cal = reg({
  firstName: "Cal",
  lastName: "Zed",
  preferredName: "Callie",
  grade: 8,
  isPreRegistered: false,
  parents: [{ firstName: "Zoe", lastName: "Zed", email: "zoe@example.com" }],
})

const dan = reg({
  firstName: "Dan",
  lastName: "Able",
  status: RegistrationStatus.CANCELLED,
  parents: [{ firstName: "Dee", lastName: "Able", email: "dee@example.com" }],
})

const everyone = [dan, cal, bea, ada]

const quickExport = (id: string) => {
  const found = QUICK_EXPORTS.find((e) => e.id === id)
  if (!found) throw new Error(`no quick export ${id}`)
  return found
}

describe("camperName", () => {
  it("prefers the denormalized camperName", () => {
    expect(camperName(ada)).toBe("Ada Lovelace")
    expect(camperName(bea)).toBe("Bea Smith")
  })

  it("falls back to first and last name, skipping missing parts", () => {
    expect(camperName(cal)).toBe("Cal Zed")
    expect(camperName(reg({ firstName: "Solo" }))).toBe("Solo")
    expect(camperName(reg({}))).toBe("")
  })
})

describe("collectContacts", () => {
  it("merges parent and family-account emails, deduplicated case-insensitively", () => {
    const contacts = collectContacts([ada, bea])
    expect(contacts.map((c) => c.email)).toEqual([
      "alan@example.com",
      "bea.parent@example.com",
      "Grace@example.com",
      "shared@example.com",
    ])
    expect(contacts.find((c) => c.email === "Grace@example.com")).toEqual({
      email: "Grace@example.com",
      firstName: "Grace",
      lastName: "Hopper",
    })
    expect(contacts.find((c) => c.email === "shared@example.com")).toEqual({
      email: "shared@example.com",
      firstName: "",
      lastName: "",
    })
  })

  it("fills in names from a later parent document", () => {
    const contacts = collectContacts([
      reg({ familyData: { emails: ["x@example.com"] } }),
      reg({
        parents: [{ email: "X@example.com", firstName: "Xa", lastName: "Xb" }],
      }),
    ])
    expect(contacts).toEqual([
      { email: "x@example.com", firstName: "Xa", lastName: "Xb" },
    ])
  })

  it("ignores blank emails", () => {
    expect(
      collectContacts([reg({ parents: [{ email: "  " }, {}] })])
    ).toEqual([])
  })
})

describe("QUICK_EXPORTS", () => {
  it("offers the five retired scripts", () => {
    expect(QUICK_EXPORTS.map((e) => e.id)).toEqual([
      "active-addresses",
      "active-emails",
      "prereg-emails",
      "prereg-campers",
      "active-info",
    ])
    const suffixes = QUICK_EXPORTS.map((e) => e.fileSuffix)
    expect(new Set(suffixes).size).toBe(suffixes.length)
    QUICK_EXPORTS.forEach((e) => {
      expect(e.label).not.toBe("")
      expect(e.description).not.toBe("")
    })
  })

  it("active-addresses: one row per Active registration, sorted by camper", () => {
    const table = quickExport("active-addresses").build(everyone, {
      canReadHealth: true,
    })
    expect(table.headers).toEqual([
      "Camper",
      "Parent Names",
      "Street",
      "Suite / Apt",
      "City",
      "State",
      "Zip",
      "Country",
    ])
    expect(table.rows).toEqual([
      [
        "Ada Lovelace",
        "Grace Hopper, Alan Turing",
        "1 Main St",
        "Apt 2",
        "Pasadena",
        "CA",
        "91101",
        "US",
      ],
      ["Cal Zed", "Zoe Zed", "", "", "", "", "", ""],
    ])
  })

  it("active-emails: contacts for Active registrations only", () => {
    const table = quickExport("active-emails").build(everyone, {
      canReadHealth: false,
    })
    expect(table.headers).toEqual(["Email", "First Name", "Last Name"])
    expect(table.rows.map((row) => row[0])).toEqual([
      "alan@example.com",
      "Grace@example.com",
      "shared@example.com",
      "zoe@example.com",
    ])
  })

  it("prereg-emails: contacts for pre-registered campers whatever their status", () => {
    const table = quickExport("prereg-emails").build(everyone, {
      canReadHealth: false,
    })
    // Bea's family lists the shared address first, so its casing wins.
    expect(table.rows.map((row) => row[0])).toEqual([
      "alan@example.com",
      "bea.parent@example.com",
      "Grace@example.com",
      "Shared@example.com",
    ])
  })

  it("prereg-campers: status, grade and parent emails", () => {
    const table = quickExport("prereg-campers").build(everyone, {
      canReadHealth: false,
    })
    expect(table.headers).toEqual(["Camper", "Status", "Grade", "Parent Emails"])
    expect(table.rows).toEqual([
      ["Ada Lovelace", "Active", 7, "Grace@example.com, alan@example.com"],
      ["Bea Smith", "Waitlist", 9, "bea.parent@example.com"],
    ])
  })

  it("active-info: includes the health columns only when the role can read them", () => {
    const withHealth = quickExport("active-info").build(everyone, {
      canReadHealth: true,
    })
    expect(withHealth.headers).toHaveLength(15)
    expect(withHealth.headers).toContain("Medical Conditions")
    expect(withHealth.headers).toContain("Diet and Food Allergies")
    expect(withHealth.rows[0]).toEqual([
      "Ada",
      "Lovelace",
      "",
      "3/5/2012",
      7,
      "Female",
      "she/her",
      "M",
      "yes",
      "no",
      "Asthma",
      "Peanuts",
      "With Bea",
      "Arrives late",
      "Scholarship",
    ])

    const withoutHealth = quickExport("active-info").build(everyone, {
      canReadHealth: false,
    })
    expect(withoutHealth.headers).toHaveLength(13)
    expect(withoutHealth.headers).not.toContain("Medical Conditions")
    expect(withoutHealth.rows[0]).not.toContain("Asthma")
    withoutHealth.rows.forEach((row) => expect(row).toHaveLength(13))

    const calRow = withoutHealth.rows[1]
    expect(calRow[0]).toBe("Cal")
    expect(calRow[2]).toBe("Callie")
    expect(calRow[3]).toBe("")
  })
})

describe("matchCampersByName", () => {
  it("matches full or preferred names regardless of case and spacing", () => {
    const { matched, notFound } = matchCampersByName(everyone, [
      "ada   lovelace",
      "CALLIE ZED",
      " Nobody Here ",
      "Bea Smith",
      "bea smith",
    ])
    expect(matched).toEqual([ada, bea, cal])
    expect(notFound).toEqual(["Nobody Here"])
  })

  it("ignores blank names", () => {
    expect(matchCampersByName(everyone, ["", "   "])).toEqual({
      matched: [],
      notFound: [],
    })
  })
})

describe("namedCampersTable", () => {
  it("lists camper, status, birthday and every family contact", () => {
    const table = namedCampersTable([ada])
    expect(table.headers).toEqual([
      "Camper",
      "Status",
      "Birthday",
      "Parent Names",
      "Parent Emails",
      "Family Account Emails",
    ])
    expect(table.rows).toEqual([
      [
        "Ada Lovelace",
        "Active",
        "3/5/2012",
        "Grace Hopper, Alan Turing",
        "Grace@example.com, alan@example.com",
        "grace@example.com, shared@example.com",
      ],
    ])
  })
})

describe("exportFileName", () => {
  it("is <year>-lyf-<suffix>-<date>", () => {
    expect(exportFileName(2026, "active-addresses", dayjs("2026-10-30"))).toBe(
      "2026-lyf-active-addresses-2026-10-30"
    )
  })
})
