import { initializeApp } from "firebase/app"
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  getFirestore,
  increment,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"

import { CampTrack, RegistrationStatus } from "../src/camp"
import { CURRENT_SCHEMA_VERSION } from "../src/utils"
import {
  MAX_CAMPERS_PER_REGISTRATION,
  SchemaValidationError,
  getFieldValueKind,
  isDocumentReferenceLike,
  isFieldValueSentinel,
  isTimestampLike,
  safeValidateFamilyWrite,
  safeValidateRegistrationPayload,
  safeValidateRegistrationWrite,
  validateAdminAuditLogEntryRead,
  validateAdminAuditLogEntryWrite,
  validateAdminRead,
  validateAdminWrite,
  validateCampCreditRead,
  validateCampCreditWrite,
  validateCampYearRead,
  validateCampYearWrite,
  validateCamperHealthWrite,
  validateCamperRead,
  validateCamperWrite,
  validateDemographicsWrite,
  validateFamilyRead,
  validateFamilyWrite,
  validateHouseholdCultureWrite,
  validateManageAdminRequest,
  validateMoveCampersOffWaitlistRequest,
  validateParentWrite,
  validatePaymentRead,
  validatePaymentWrite,
  validatePreRegistrationPayload,
  validateRegistrationPayload,
  validateRegistrationRead,
  validateRegistrationWrite,
} from "../src/validation"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Real client SDK references need a Firestore instance; no network is touched
// by creating them.
const firestore = getFirestore(initializeApp({ projectId: "demo-validation" }))
const familyRef = doc(firestore, "families/fam1")
const camperRef = doc(firestore, "families/fam1/campers/camper1")
const registrationRef = doc(firestore, "camps/2026/registrations/camper1")
const paymentRef = doc(firestore, "payments/cs_test_123")

// Stand-ins shaped like firebase-admin's sentinels: `*Transform` classes
// exposing a `methodName` getter and (for arrays) an `elements` property.
class ServerTimestampTransform {
  get methodName() {
    return "FieldValue.serverTimestamp"
  }
}
class ArrayUnionTransform {
  readonly elements: unknown[]
  constructor(...elements: unknown[]) {
    this.elements = elements
  }
  get methodName() {
    return "FieldValue.arrayUnion"
  }
}
class NumericIncrementTransform {
  constructor(readonly operand: number) {}
  get methodName() {
    return "FieldValue.increment"
  }
}
class DeleteTransform {
  get methodName() {
    return "FieldValue.delete"
  }
}
const admin = {
  serverTimestamp: () => new ServerTimestampTransform(),
  arrayUnion: (...elements: unknown[]) => new ArrayUnionTransform(...elements),
  increment: (n: number) => new NumericIncrementTransform(n),
  delete: () => new DeleteTransform(),
}

// Shaped like an admin SDK Timestamp: private fields plus getters.
class AdminTimestamp {
  constructor(
    private readonly _seconds: number,
    private readonly _nanoseconds: number
  ) {}
  get seconds() {
    return this._seconds
  }
  get nanoseconds() {
    return this._nanoseconds
  }
  toDate() {
    return new Date(this._seconds * 1000)
  }
  toMillis() {
    return this._seconds * 1000
  }
}
// Admin SDK refs are a different class; structurally they carry id and path.
const adminRef = (path: string) => ({ id: path.split("/").pop()!, path })

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(SchemaValidationError)
    return [...(e as SchemaValidationError).issues]
  }
  throw new Error("expected the validator to throw")
}

function expectIssue(
  fn: () => unknown,
  path: string,
  messagePattern?: RegExp
): void {
  const issues = issuesOf(fn)
  const match = issues.find((i) => i.path === path)
  expect(match).toBeDefined()
  if (messagePattern) expect(match!.message).toMatch(messagePattern)
}

// ---------------------------------------------------------------------------
// Firestore value detection
// ---------------------------------------------------------------------------

describe("Firestore value detection", () => {
  it("classifies every client SDK sentinel", () => {
    expect(getFieldValueKind(serverTimestamp())).toBe("serverTimestamp")
    expect(getFieldValueKind(arrayUnion(1))).toBe("arrayUnion")
    expect(getFieldValueKind(arrayRemove(1))).toBe("arrayRemove")
    expect(getFieldValueKind(increment(1))).toBe("increment")
    expect(getFieldValueKind(deleteField())).toBe("delete")
  })

  it("classifies admin SDK shaped sentinels", () => {
    expect(getFieldValueKind(admin.serverTimestamp())).toBe("serverTimestamp")
    expect(getFieldValueKind(admin.arrayUnion("x"))).toBe("arrayUnion")
    expect(getFieldValueKind(admin.increment(1))).toBe("increment")
    expect(getFieldValueKind(admin.delete())).toBe("delete")
  })

  it("falls back to the constructor name", () => {
    class ArrayRemoveFieldValueImpl {}
    expect(getFieldValueKind(new ArrayRemoveFieldValueImpl())).toBe(
      "arrayRemove"
    )
  })

  it("does not mistake ordinary values for sentinels", () => {
    for (const value of [
      null,
      undefined,
      1,
      "serverTimestamp",
      {},
      { _methodName: 1 },
      [],
      new Date(),
    ]) {
      expect(isFieldValueSentinel(value)).toBe(false)
    }
  })

  it("recognises Timestamps from both SDKs but not plain JSON", () => {
    expect(isTimestampLike(Timestamp.now())).toBe(true)
    expect(isTimestampLike(new AdminTimestamp(1, 0))).toBe(true)
    expect(isTimestampLike({ seconds: 1, nanoseconds: 0 })).toBe(false)
    expect(isTimestampLike(new Date())).toBe(false)
    expect(isTimestampLike(serverTimestamp())).toBe(false)
  })

  it("recognises DocumentReferences structurally", () => {
    expect(isDocumentReferenceLike(camperRef)).toBe(true)
    expect(isDocumentReferenceLike(adminRef("families/f/campers/c"))).toBe(true)
    expect(
      isDocumentReferenceLike({ id: "c", path: "families/f/campers/other" })
    ).toBe(false)
    expect(
      isDocumentReferenceLike({ id: "campers", path: "families/f/campers" })
    ).toBe(false)
    expect(isDocumentReferenceLike({ id: "", path: "" })).toBe(false)
    expect(isDocumentReferenceLike("families/f/campers/c")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// What createOrUpdateRegistration writes with set(..., {merge: true}).
const registrationWrite = {
  camperName: "Mei Lin",
  camper: camperRef,
  campTrack: CampTrack.YOUNGER,
  grade: 6,
  status: RegistrationStatus.PENDING_PAYMENT,
  spotReserved: true,
  shirtSize: "YM",
  isReturning: false,
  cabinPreference: "",
  updatedAt: serverTimestamp(),
  waitlistTime: serverTimestamp(),
  additionalNotes: null,
  waiverFullName: "Pat Lin",
  waiverSignature: "Pat Lin",
  waiverSignDate: "2026-03-01",
  preferredName: null,
  birthDate: "2014-05-06",
  gender: ["Female"],
  pronouns: "she/her",
  parentContacts: [
    {
      firstName: "Pat",
      lastName: "Lin",
      email: "pat@example.com",
      phoneNumber: "555-0100",
    },
    { firstName: "Sam", lastName: "Lin", email: "", phoneNumber: "" },
  ],
  familyEmails: ["pat@example.com", "sam@example.com"],
  schemaVersion: CURRENT_SCHEMA_VERSION,
}

describe("validateRegistrationWrite", () => {
  it("accepts the registration function's merge write", () => {
    expect(validateRegistrationWrite(registrationWrite)).toEqual(
      registrationWrite
    )
  })

  it("accepts the Stripe fulfilment update", () => {
    const update = {
      payments: arrayUnion(paymentRef),
      status: RegistrationStatus.ACTIVE,
      updatedAt: serverTimestamp(),
    }
    expect(validateRegistrationWrite(update)).toEqual(update)
  })

  it("accepts the waitlist transaction update with admin SDK sentinels", () => {
    const update = {
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
      updatedAt: admin.serverTimestamp(),
      payments: admin.arrayUnion(adminRef("payments/cs_1")),
    }
    expect(validateRegistrationWrite(update)).toEqual(update)
  })

  it("accepts the pre-registration deposit write", () => {
    const update = {
      status: RegistrationStatus.PARTIAL_PAYMENT,
      amountPaid: admin.increment(500),
      isPreRegistered: true,
      payments: admin.arrayUnion(adminRef("payments/pi_1")),
    }
    expect(validateRegistrationWrite(update)).toEqual(update)
    expect(validateRegistrationWrite({ amountPaid: 500 })).toEqual({
      amountPaid: 500,
    })
    expectIssue(
      () => validateRegistrationWrite({ amountPaid: -1 }),
      "amountPaid"
    )
    expectIssue(
      () => validateRegistrationWrite({ amountPaid: "500" }),
      "amountPaid"
    )
  })

  it("accepts the initial create() and a field deletion", () => {
    expect(
      validateRegistrationWrite({
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isTestData: false,
      })
    ).toBeDefined()
    expect(
      validateRegistrationWrite({ internalNotes: deleteField() })
    ).toBeDefined()
    expect(validateRegistrationWrite({ hasContacted: true })).toBeDefined()
  })

  it("accepts an empty merge", () => {
    expect(validateRegistrationWrite({})).toEqual({})
  })

  it("rejects an unknown status", () => {
    expectIssue(
      () => validateRegistrationWrite({ ...registrationWrite, status: "Paid" }),
      "status",
      /Active|Pending Payment/
    )
  })

  it("rejects non-lowercase familyEmails and points at the element", () => {
    expectIssue(
      () =>
        validateRegistrationWrite({
          ...registrationWrite,
          familyEmails: ["pat@example.com", "Sam@Example.com"],
        }),
      "familyEmails[1]",
      /normalized/
    )
  })

  it("rejects unknown keys by default and accepts them on request", () => {
    const input = { ...registrationWrite, shirtsize: "YM" }
    expectIssue(() => validateRegistrationWrite(input), "(root)", /shirtsize/)
    expect(
      validateRegistrationWrite(input, { allowUnknownKeys: true })
    ).toEqual(input)
  })

  it("rejects wrong array element types", () => {
    expectIssue(
      () => validateRegistrationWrite({ gender: ["Female", 2] }),
      "gender[1]",
      /expected string/
    )
    expectIssue(
      () => validateRegistrationWrite({ payments: ["payments/x"] }),
      "payments[0]",
      /DocumentReference/
    )
    expectIssue(
      () =>
        validateRegistrationWrite({
          parentContacts: [
            { firstName: "Pat", lastName: "Lin", email: "pat@example.com" },
          ],
        }),
      "parentContacts[0].phoneNumber"
    )
    expectIssue(
      () =>
        validateRegistrationWrite({
          parentContacts: [
            {
              firstName: "Pat",
              lastName: "Lin",
              email: "Pat@Example.com",
              phoneNumber: "",
            },
          ],
        }),
      "parentContacts[0].email",
      /normalized/
    )
  })

  it("rejects a sentinel of the wrong kind", () => {
    expect(() =>
      validateRegistrationWrite({ status: serverTimestamp() })
    ).toThrow(SchemaValidationError)
    expect(() => validateRegistrationWrite({ grade: arrayUnion(1) })).toThrow(
      SchemaValidationError
    )
    expect(() =>
      validateRegistrationWrite({ updatedAt: increment(1) })
    ).toThrow(SchemaValidationError)
  })

  it("validates the elements inside arrayUnion against the element schema", () => {
    expectIssue(
      () =>
        validateRegistrationWrite({
          familyEmails: arrayUnion("Pat@Example.com"),
        }),
      "familyEmails[0]",
      /normalized/
    )
    expectIssue(
      () =>
        validateRegistrationWrite({ payments: admin.arrayUnion("payments/x") }),
      "payments[0]",
      /DocumentReference/
    )
  })

  it("rejects bad scalar values", () => {
    expectIssue(
      () => validateRegistrationWrite({ schemaVersion: 0 }),
      "schemaVersion"
    )
    expectIssue(
      () => validateRegistrationWrite({ schemaVersion: 2.5 }),
      "schemaVersion"
    )
    expectIssue(
      () =>
        validateRegistrationWrite({
          schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        }),
      "schemaVersion"
    )
    expectIssue(() => validateRegistrationWrite({ grade: 42 }), "grade")
    expectIssue(() => validateRegistrationWrite({ grade: "6" }), "grade")
    expectIssue(
      () => validateRegistrationWrite({ updatedAt: new Date() }),
      "updatedAt",
      /Timestamp/
    )
    expectIssue(
      () => validateRegistrationWrite({ camper: "families/f/campers/c" }),
      "camper"
    )
    expectIssue(
      () => validateRegistrationWrite({ hasContacted: false }),
      "hasContacted"
    )
    expectIssue(
      () => validateRegistrationWrite({ additionalNotes: 5 }),
      "additionalNotes"
    )
  })

  it("rejects a non-object input", () => {
    expect(() => validateRegistrationWrite(null)).toThrow(SchemaValidationError)
    expect(() => validateRegistrationWrite("x")).toThrow(SchemaValidationError)
    expect(() => validateRegistrationWrite([registrationWrite])).toThrow(
      SchemaValidationError
    )
  })

  it("lists every issue in a readable message", () => {
    const result = safeValidateRegistrationWrite({
      status: "Nope",
      familyEmails: ["A@B.com"],
      bogus: 1,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBeInstanceOf(SchemaValidationError)
    expect(result.error.name).toBe("SchemaValidationError")
    expect(result.error.issues.map((i) => i.path).sort()).toEqual(
      ["(root)", "familyEmails[0]", "status"].sort()
    )
    expect(result.error.message).toMatch(
      /^Invalid Registration write \(3 issues\): /
    )
    expect(result.error.message).toContain("status: ")
    expect(result.error.message).toContain("familyEmails[0]: ")
  })
})

describe("validateRegistrationRead", () => {
  const stored = {
    camperName: "Mei Lin",
    camper: camperRef,
    campTrack: CampTrack.OLDER,
    grade: 9,
    status: RegistrationStatus.ACTIVE,
    createdAt: Timestamp.now(),
    updatedAt: new AdminTimestamp(1_700_000_000, 0),
    payments: [paymentRef, adminRef("payments/cs_2")],
    parentContacts: [
      {
        firstName: "Pat",
        lastName: "Lin",
        email: "Pat@Example.com",
        phoneNumber: "",
      },
    ],
    familyEmails: ["Legacy@Example.com"],
    demographics: { ethnicity: ["Taiwanese"], born: "US" },
    schemaVersion: 1,
  }

  it("accepts stored documents, including legacy un-normalized emails", () => {
    expect(validateRegistrationRead(stored)).toEqual(stored)
  })

  it("rejects sentinels and wrong types", () => {
    expectIssue(
      () => validateRegistrationRead({ updatedAt: serverTimestamp() }),
      "updatedAt",
      /Timestamp/
    )
    expectIssue(
      () => validateRegistrationRead({ payments: arrayUnion(paymentRef) }),
      "payments"
    )
    expectIssue(() => validateRegistrationRead({ status: "Paid" }), "status")
    expectIssue(
      () => validateRegistrationRead({ spotReserved: "yes" }),
      "spotReserved"
    )
  })

  it("rejects unknown keys unless allowed", () => {
    const legacy = { ...stored, legacyField: "x" }
    expect(() => validateRegistrationRead(legacy)).toThrow(
      SchemaValidationError
    )
    expect(
      validateRegistrationRead(legacy, { allowUnknownKeys: true })
    ).toEqual(legacy)
  })
})

// ---------------------------------------------------------------------------
// Family / Parent / Camper / private sub-documents
// ---------------------------------------------------------------------------

describe("validateFamilyWrite", () => {
  const write = {
    emails: arrayUnion("pat@example.com", "sam@example.com"),
    confirmedEmails: arrayUnion("pat@example.com"),
    household: { camperMessage: "Have fun", languageFrequency: "Daily" },
    city: "San Jose",
    state: "CA",
    zip: "95110",
    street: "1 Main St",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdBy: "pat@example.com",
  }

  it("accepts the registration function's family write", () => {
    expect(validateFamilyWrite(write)).toEqual(write)
    expect(
      validateFamilyWrite({
        ...write,
        emails: admin.arrayUnion("pat@example.com"),
      })
    ).toBeDefined()
  })

  it("rejects un-normalized emails in arrays, sentinels and createdBy", () => {
    expectIssue(
      () => validateFamilyWrite({ emails: ["Pat@Example.com"] }),
      "emails[0]",
      /normalized/
    )
    expectIssue(
      () => validateFamilyWrite({ emails: [" pat@example.com"] }),
      "emails[0]"
    )
    expectIssue(
      () => validateFamilyWrite({ emails: ["not-an-email"] }),
      "emails[0]",
      /email/
    )
    expectIssue(
      () => validateFamilyWrite({ emails: arrayUnion("Pat@Example.com") }),
      "emails[0]"
    )
    expectIssue(
      () =>
        validateFamilyWrite({ emails: admin.arrayUnion("Pat@Example.com") }),
      "emails[0]"
    )
    expectIssue(
      () => validateFamilyWrite({ createdBy: "PAT@example.com" }),
      "createdBy"
    )
  })

  it("checks nested household keys", () => {
    expectIssue(
      () => validateFamilyWrite({ household: { cultureLesson: 1 } }),
      "household.cultureLesson"
    )
    expectIssue(
      () => validateFamilyWrite({ household: { typo: "x" } }),
      "household",
      /typo/
    )
    expect(validateFamilyWrite({ household: deleteField() })).toBeDefined()
  })

  it("supports safeValidate", () => {
    const ok = safeValidateFamilyWrite({ city: "x" })
    expect(ok).toEqual({ success: true, data: { city: "x" } })
    const bad = safeValidateFamilyWrite({ city: 1 })
    expect(bad.success).toBe(false)
  })
})

describe("validateFamilyRead", () => {
  it("accepts legacy documents with mixed-case emails", () => {
    const stored = { emails: ["Pat@Example.com"], city: "SJ" }
    expect(validateFamilyRead(stored)).toEqual(stored)
  })
  it("still requires arrays of strings", () => {
    expectIssue(
      () => validateFamilyRead({ emails: "pat@example.com" }),
      "emails"
    )
  })
})

describe("validateParentWrite", () => {
  it("accepts the registration function's parent write (blank email allowed)", () => {
    const write = {
      email: "pat@example.com",
      firstName: "Pat",
      lastName: "Lin",
      phoneNumber: "555",
      lineId: "",
      subscribeToMailingList: true,
    }
    expect(validateParentWrite(write)).toEqual(write)
    expect(validateParentWrite({ email: "" })).toEqual({ email: "" })
    expect(validateParentWrite({ lineId: null })).toEqual({ lineId: null })
    expect(validateParentWrite({ stripeCustomerId: "cus_123" })).toBeDefined()
  })
  it("rejects un-normalized or malformed emails", () => {
    expectIssue(
      () => validateParentWrite({ email: "Pat@Example.com" }),
      "email"
    )
    expectIssue(() => validateParentWrite({ email: "pat" }), "email")
    expectIssue(
      () => validateParentWrite({ subscribeToMailingList: "yes" }),
      "subscribeToMailingList"
    )
    expectIssue(() => validateParentWrite({ lineId: 1 }), "lineId")
  })
})

describe("validateCamperWrite / Read", () => {
  it("accepts the camper base document and the registrations arrayUnion", () => {
    const write = {
      firstName: "Mei",
      lastName: "Lin",
      preferredName: null,
      birthDate: "2014-05-06",
      gender: ["Female"],
      pronouns: null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
    expect(validateCamperWrite(write)).toEqual(write)
    expect(
      validateCamperWrite({ registrations: arrayUnion(registrationRef) })
    ).toBeDefined()
    expect(
      validateCamperWrite({
        registrations: admin.arrayUnion(adminRef("camps/2026/registrations/c")),
      })
    ).toBeDefined()
  })

  it("rejects bad registrations and gender", () => {
    expectIssue(
      () =>
        validateCamperWrite({ registrations: ["camps/2026/registrations/c"] }),
      "registrations[0]"
    )
    expectIssue(
      () => validateCamperWrite({ registrations: arrayUnion("nope") }),
      "registrations[0]"
    )
    expectIssue(() => validateCamperWrite({ gender: "Female" }), "gender")
    expectIssue(
      () => validateCamperWrite({ preferredName: 1 }),
      "preferredName"
    )
  })

  it("reads stored campers", () => {
    const stored = {
      id: "camper1",
      firstName: "Mei",
      registrations: [registrationRef],
      gender: [],
    }
    expect(validateCamperRead(stored)).toEqual(stored)
  })
})

describe("private sub-documents", () => {
  it("validates health", () => {
    expect(
      validateCamperHealthWrite({
        dietAndFoodAllergies: null,
        medicalConditions: "Asthma",
      })
    ).toBeDefined()
    expectIssue(
      () => validateCamperHealthWrite({ medicalConditions: ["Asthma"] }),
      "medicalConditions"
    )
    expectIssue(
      () => validateCamperHealthWrite({ allergies: "x" }),
      "(root)",
      /allergies/
    )
  })

  it("validates demographics", () => {
    const write = {
      born: "US",
      ethnicity: ["Taiwanese", "Hakka"],
      generation: "2nd",
    }
    expect(validateDemographicsWrite(write)).toEqual(write)
    expectIssue(
      () => validateDemographicsWrite({ ethnicity: "Taiwanese" }),
      "ethnicity"
    )
  })

  it("validates household culture", () => {
    expect(
      validateHouseholdCultureWrite({ cultureLesson: "Food" })
    ).toBeDefined()
    expectIssue(
      () => validateHouseholdCultureWrite({ cultureLesson: ["Food"] }),
      "cultureLesson"
    )
  })
})

// ---------------------------------------------------------------------------
// Payment / CampCredit / CampYear
// ---------------------------------------------------------------------------

describe("validatePaymentWrite / Read", () => {
  // From fulfillRegistration.
  const write = {
    customerEmail: "Pat@Example.com",
    customerName: "Pat Lin",
    customerId: "cus_123",
    donation: 20,
    discount: { amount: 50, name: "Sibling discount" },
    items: [
      { amount: 450, description: "LYF Camp 2026 Registration - Mei Lin" },
      { amount: 20, description: "Donation" },
    ],
    paymentMethod: "card",
    registrations: arrayUnion(registrationRef),
    status: "paid",
    stripeId: "cs_test_123",
    type: "Stripe",
    total: 420,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  it("accepts the Stripe fulfilment write (Stripe emails are not normalized)", () => {
    expect(validatePaymentWrite(write)).toEqual(write)
    expect(validatePaymentWrite({ ...write, discount: null })).toBeDefined()
  })

  it("rejects negative or non-finite amounts", () => {
    expectIssue(() => validatePaymentWrite({ total: -1 }), "total")
    expectIssue(() => validatePaymentWrite({ total: NaN }), "total")
    expectIssue(() => validatePaymentWrite({ donation: Infinity }), "donation")
    expectIssue(
      () => validatePaymentWrite({ items: [{ amount: -5, description: "x" }] }),
      "items[0].amount"
    )
    expectIssue(
      () => validatePaymentWrite({ discount: { amount: 5 } }),
      "discount.name"
    )
    expectIssue(() => validatePaymentWrite({ discount: "none" }), "discount")
  })

  it("reads stored payments with any finite amount", () => {
    const stored = {
      total: 100,
      createdAt: Timestamp.now(),
      registrations: [registrationRef],
    }
    expect(validatePaymentRead(stored)).toEqual(stored)
    expectIssue(() => validatePaymentRead({ total: "100" }), "total")
  })
})

describe("validateCampCreditWrite / Read", () => {
  it("accepts increments and note appends", () => {
    const update = {
      amountRemaining: increment(-50),
      notes: arrayUnion("-50: 2026 LYF Camp Registration"),
    }
    expect(validateCampCreditWrite(update)).toEqual(update)
    expect(
      validateCampCreditWrite({
        amountRemaining: admin.increment(-50),
        family: familyRef,
      })
    ).toBeDefined()
    expect(
      validateCampCreditWrite({
        amountRemaining: 100,
        notes: ["+100: 2026 refund"],
      })
    ).toBeDefined()
  })

  it("rejects negative balances and bad notes", () => {
    expectIssue(
      () => validateCampCreditWrite({ amountRemaining: -5 }),
      "amountRemaining"
    )
    expectIssue(() => validateCampCreditWrite({ notes: [1] }), "notes[0]")
    expectIssue(
      () => validateCampCreditWrite({ notes: arrayUnion(1) }),
      "notes[0]"
    )
    expectIssue(
      () => validateCampCreditWrite({ family: "families/f" }),
      "family"
    )
  })

  it("reads stored credits", () => {
    expect(
      validateCampCreditRead({
        amountRemaining: 25,
        family: familyRef,
        notes: [],
      })
    ).toBeDefined()
  })
})

describe("validateCampYearWrite / Read", () => {
  it("accepts a partial remainingSpots map on write", () => {
    const update = { remainingSpots: { [CampTrack.YOUNGER]: 3 } }
    expect(validateCampYearWrite(update)).toEqual(update)
    expect(
      validateCampYearWrite({
        remainingSpots: { [CampTrack.YOUNGER]: 0, [CampTrack.OLDER]: 12 },
        campSizeCaps: { [CampTrack.OLDER]: 80 },
        registrationFee: 450,
        registrationLateDate: Timestamp.now(),
        name: "LYF Camp 2026",
      })
    ).toBeDefined()
  })

  it("accepts negative remainingSpots (over-cap admissions) but not negative caps", () => {
    const overCap = {
      remainingSpots: { [CampTrack.YOUNGER]: -33, [CampTrack.OLDER]: -36 },
    }
    expect(validateCampYearWrite(overCap)).toEqual(overCap)
    expectIssue(
      () =>
        validateCampYearWrite({ campSizeCaps: { [CampTrack.YOUNGER]: -1 } }),
      "campSizeCaps.Younger"
    )
    expectIssue(
      () => validateCampYearWrite({ campTotalSizeCap: -1 }),
      "campTotalSizeCap"
    )
  })

  it("rejects unknown tracks and fractional counts", () => {
    expectIssue(
      () => validateCampYearWrite({ remainingSpots: { Middle: 3 } }),
      "remainingSpots",
      /Middle/
    )
    expectIssue(
      () =>
        validateCampYearWrite({ remainingSpots: { [CampTrack.YOUNGER]: 1.5 } }),
      "remainingSpots.Younger"
    )
    expectIssue(
      () => validateCampYearWrite({ registrationFee: -450 }),
      "registrationFee"
    )
    expectIssue(
      () => validateCampYearWrite({ campStartDate: "2026-07-01" }),
      "campStartDate"
    )
  })

  it("requires every track in remainingSpots when reading", () => {
    const stored = {
      remainingSpots: { [CampTrack.YOUNGER]: 3, [CampTrack.OLDER]: 4 },
      campSizeCaps: { [CampTrack.YOUNGER]: 60, [CampTrack.OLDER]: 80 },
      registrationFee: 450,
    }
    expect(validateCampYearRead(stored)).toEqual(stored)
    expectIssue(
      () =>
        validateCampYearRead({ remainingSpots: { [CampTrack.YOUNGER]: 3 } }),
      "remainingSpots.Older"
    )
  })
})

// ---------------------------------------------------------------------------
// Admin / audit log
// ---------------------------------------------------------------------------

describe("validateAdminWrite / Read", () => {
  it("accepts manageAdmin's writes", () => {
    const add = {
      role: "full_admin",
      addedBy: "root@example.com",
      disabled: false,
      addedAt: serverTimestamp(),
    }
    expect(validateAdminWrite(add)).toEqual(add)
    expect(validateAdminWrite({ role: "health_staff" })).toBeDefined()
    expect(validateAdminWrite({ disabled: true })).toBeDefined()
  })

  it("rejects unknown roles and un-normalized actors", () => {
    expectIssue(
      () => validateAdminWrite({ role: "superadmin" }),
      "role",
      /full_admin/
    )
    expectIssue(
      () => validateAdminWrite({ addedBy: "Root@Example.com" }),
      "addedBy"
    )
    expectIssue(() => validateAdminWrite({ disabled: "true" }), "disabled")
  })

  it("reads stored admins", () => {
    const stored = {
      role: "program_staff",
      addedBy: "root@example.com",
      addedAt: Timestamp.now(),
      disabled: false,
    }
    expect(validateAdminRead(stored)).toEqual(stored)
    expectIssue(
      () => validateAdminRead({ addedAt: serverTimestamp() }),
      "addedAt"
    )
  })
})

describe("validateAdminAuditLogEntryWrite / Read", () => {
  const before = {
    role: "program_staff",
    addedBy: "root@example.com",
    addedAt: Timestamp.now(),
    disabled: false,
  }

  it("accepts the audit entry written by manageAdmin", () => {
    const entry = {
      actor: "root@example.com",
      action: "setRole",
      target: "staff@example.com",
      before,
      after: { ...before, role: "full_admin" },
      at: serverTimestamp(),
    }
    expect(validateAdminAuditLogEntryWrite(entry)).toEqual(entry)
    expect(
      validateAdminAuditLogEntryWrite({
        ...entry,
        action: "add",
        before: null,
        after: {
          role: "full_admin",
          addedBy: "root@example.com",
          disabled: false,
        },
      })
    ).toBeDefined()
    expect(
      validateAdminAuditLogEntryWrite({
        ...entry,
        action: "remove",
        after: null,
        at: admin.serverTimestamp(),
      })
    ).toBeDefined()
  })

  it("requires every field and valid actions", () => {
    expectIssue(
      () =>
        validateAdminAuditLogEntryWrite({
          action: "add",
          target: "t@example.com",
          before: null,
          after: null,
          at: serverTimestamp(),
        }),
      "actor"
    )
    expectIssue(
      () =>
        validateAdminAuditLogEntryWrite({
          actor: "a@example.com",
          action: "promote",
          target: "t@example.com",
          before: null,
          after: null,
          at: serverTimestamp(),
        }),
      "action"
    )
    expectIssue(
      () =>
        validateAdminAuditLogEntryWrite({
          actor: "a@example.com",
          action: "add",
          target: "t@example.com",
          before: null,
          after: { role: "boss" },
          at: serverTimestamp(),
        }),
      "after.role"
    )
  })

  it("reads stored entries", () => {
    const stored = {
      actor: "root@example.com",
      action: "remove",
      target: "t@example.com",
      before,
      after: null,
      at: Timestamp.now(),
    }
    expect(validateAdminAuditLogEntryRead(stored)).toEqual(stored)
    expectIssue(
      () =>
        validateAdminAuditLogEntryRead({ ...stored, at: serverTimestamp() }),
      "at"
    )
  })
})

// ---------------------------------------------------------------------------
// Callable payloads
// ---------------------------------------------------------------------------

// Shaped like what ReviewStep sends, including the leftovers the website
// spreads in from Firestore documents (family.id, parents[].id, campers[].health).
const registrationPayload = {
  campYear: 2026,
  family: {
    id: "fam1",
    city: "San Jose",
    state: "CA",
    zip: "95110",
    street: "1 Main St",
    createdBy: "pat@example.com",
    confirmedEmails: ["pat@example.com"],
    schemaVersion: 3,
  },
  parents: [
    {
      id: "p1",
      email: "Pat@Example.com",
      firstName: "Pat",
      lastName: "Lin",
      phoneNumber: "555-0100",
      subscribeToMailingList: true,
    },
    {
      firstName: "Sam",
      lastName: "Lin",
      email: "",
      phoneNumber: "555-0101",
      lineId: null,
    },
  ],
  campers: [
    {
      id: "camper1",
      firstName: "Mei",
      lastName: "Lin",
      preferredName: null,
      birthDate: "2014-05-06",
      gender: ["Female"],
      pronouns: "she/her",
      health: { dietAndFoodAllergies: null, medicalConditions: null },
      dietAndFoodAllergies: "Peanuts",
      medicalConditions: null,
      grade: 6,
      campTrack: CampTrack.YOUNGER,
      shirtSize: "YM",
      isReturning: true,
      cabinPreference: "",
      additionalNotes: null,
      waiverFullName: "Pat Lin",
      waiverSignature: "Pat Lin",
      waiverSignDate: "2026-03-01",
      status: RegistrationStatus.PENDING_PAYMENT,
    },
  ],
  demographics: [{ born: "US", ethnicity: ["Taiwanese"], generation: "2nd" }],
  donation: 25,
  household: { camperMessage: "Have fun", cultureLesson: "Food" },
  joinFamilyId: null,
  successUrl: "https://lyf-registration.tacl.org/registration?success=1",
  cancelUrl: "https://lyf-registration.tacl.org/registration?success=0",
  isTestData: false,
}

describe("validateRegistrationPayload", () => {
  it("accepts the website payload and strips document leftovers from nested objects", () => {
    const result = validateRegistrationPayload(registrationPayload)
    expect(result.campYear).toBe(2026)
    expect(result.campers[0]).not.toHaveProperty("health")
    expect(result.parents[0]).not.toHaveProperty("id")
    expect(result.family).not.toHaveProperty("id")
    expect(result.campers[0].grade).toBe(6)
    expect(result.campers[0].dietAndFoodAllergies).toBe("Peanuts")
    expect(result.parents[0].email).toBe("Pat@Example.com")
    // Legacy parent documents store lineId as null (LYF-REGISTRATION webhook
    // error "parents[0].lineId: expected string, received null").
    expect(result.parents[1].lineId).toBeNull()
  })

  it("keeps nested leftovers when unknown keys are allowed", () => {
    const result = validateRegistrationPayload(registrationPayload, {
      allowUnknownKeys: true,
    })
    expect(result.campers[0]).toHaveProperty("health")
  })

  it("rejects unknown top-level keys", () => {
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          forcewaitlist: true,
        }),
      "(root)",
      /forcewaitlist/
    )
  })

  it("enforces the parent and camper bounds", () => {
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, parents: [] }),
      "parents",
      /At least one parent/
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          parents: Array.from(
            { length: 11 },
            () => registrationPayload.parents[0]
          ),
        }),
      "parents",
      /At most 10 parents/
    )
    const tooMany = Array.from(
      { length: MAX_CAMPERS_PER_REGISTRATION + 1 },
      () => registrationPayload.campers[0]
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campers: tooMany,
          demographics: tooMany.map(() => ({})),
        }),
      "campers",
      /At most 10 campers/
    )
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, campers: [] }),
      "campers",
      /At least one camper/
    )
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, campers: "x" }),
      "campers"
    )
  })

  it("requires one demographics entry per camper", () => {
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          demographics: [],
        }),
      "demographics",
      /one entry per camper/
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          demographics: {},
        }),
      "demographics"
    )
  })

  it("checks donation, emails, grade, enums and URLs", () => {
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, donation: -1 }),
      "donation"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, donation: "25" }),
      "donation"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          donation: Infinity,
        }),
      "donation"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          parents: [{ ...registrationPayload.parents[0], email: "pat" }],
        }),
      "parents[0].email",
      /email/
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campers: [{ ...registrationPayload.campers[0], grade: 20 }],
        }),
      "campers[0].grade"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campers: [{ ...registrationPayload.campers[0], grade: 6.5 }],
        }),
      "campers[0].grade"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campers: [{ ...registrationPayload.campers[0], gender: "Female" }],
        }),
      "campers[0].gender"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campers: [{ ...registrationPayload.campers[0], status: "Paid" }],
        }),
      "campers[0].status"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          demographics: [{ ethnicity: "Taiwanese" }],
        }),
      "demographics[0].ethnicity"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          successUrl: "/registration",
        }),
      "successUrl"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          campYear: "2026",
        }),
      "campYear"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({ ...registrationPayload, campYear: 1999 }),
      "campYear"
    )
    expectIssue(
      () =>
        validateRegistrationPayload({
          ...registrationPayload,
          joinFamilyId: 5,
        }),
      "joinFamilyId"
    )
  })

  it("reports every problem at once through safeValidate", () => {
    const result = safeValidateRegistrationPayload({
      ...registrationPayload,
      donation: -1,
      campYear: "x",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((i) => i.path).sort()).toEqual([
      "campYear",
      "donation",
    ])
  })
})

describe("validatePreRegistrationPayload", () => {
  const payload = {
    campersToPreRegister: ["Mei Lin", "Kai Lin"],
    camperRefsToPreRegister: [
      "families/fam1/campers/camper1",
      "families/fam1/campers/camper2",
    ],
    camperCurrentGrades: [5, null],
    campYear: 2027,
    donationAmount: 0,
    email: "pat@example.com",
    successUrl: "https://lyf-registration.tacl.org/pre?success=1",
    cancelUrl: "https://lyf-registration.tacl.org/pre?success=0",
    isTestData: true,
  }

  it("accepts a valid payload", () => {
    expect(validatePreRegistrationPayload(payload)).toEqual(payload)
    const { camperCurrentGrades, isTestData, ...minimal } = payload
    expect(validatePreRegistrationPayload(minimal)).toEqual(minimal)
  })

  it("normalizes `false` and missing current grades to null", () => {
    // The website sends `false` for a camper with no active registration this
    // year (see CamperCheckoutFlow); it must not block pre-registration.
    expect(
      validatePreRegistrationPayload({
        ...payload,
        camperCurrentGrades: [false, undefined],
      })
    ).toEqual({ ...payload, camperCurrentGrades: [null, null] })
  })

  it("requires refs (and grades, when present) to line up with campers", () => {
    expectIssue(
      () =>
        validatePreRegistrationPayload({
          ...payload,
          camperRefsToPreRegister: payload.camperRefsToPreRegister.slice(0, 1),
        }),
      "camperRefsToPreRegister",
      /one entry per camper/
    )
    expectIssue(
      () =>
        validatePreRegistrationPayload({
          ...payload,
          camperCurrentGrades: [5],
        }),
      "camperCurrentGrades"
    )
  })

  it("rejects malformed refs, emails, URLs, grades and donations", () => {
    expectIssue(
      () =>
        validatePreRegistrationPayload({
          ...payload,
          camperRefsToPreRegister: [
            "families/fam1/campers",
            "families/fam1/campers/c2",
          ],
        }),
      "camperRefsToPreRegister[0]",
      /document path/
    )
    // Any other document path is rejected too: the function writes to this
    // path (and its parent family) when the payment lands.
    for (const path of [
      "admins/root@example.com",
      "camps/2026/registrations/reg1",
      "families/fam1/parents/pat@example.com",
      "families/fam1/campers/c1/private/health",
    ]) {
      expectIssue(
        () =>
          validatePreRegistrationPayload({
            ...payload,
            camperRefsToPreRegister: [path, "families/fam1/campers/c2"],
          }),
        "camperRefsToPreRegister[0]",
        /camper document path/
      )
    }
    expectIssue(
      () => validatePreRegistrationPayload({ ...payload, email: "pat" }),
      "email"
    )
    expectIssue(
      () => validatePreRegistrationPayload({ ...payload, cancelUrl: "nope" }),
      "cancelUrl"
    )
    expectIssue(
      () =>
        validatePreRegistrationPayload({
          ...payload,
          camperCurrentGrades: [5, 99],
        }),
      "camperCurrentGrades[1]"
    )
    expectIssue(
      () => validatePreRegistrationPayload({ ...payload, donationAmount: -10 }),
      "donationAmount"
    )
    expectIssue(
      () => validatePreRegistrationPayload({ ...payload, extra: 1 }),
      "(root)",
      /extra/
    )
    expectIssue(
      () =>
        validatePreRegistrationPayload({
          ...payload,
          campersToPreRegister: Array(11).fill("x"),
          camperRefsToPreRegister: Array(11).fill("families/f/campers/c"),
        }),
      "campersToPreRegister"
    )
  })
})

describe("validateManageAdminRequest", () => {
  it("accepts each action with its required fields", () => {
    expect(
      validateManageAdminRequest({
        action: "add",
        email: "New@Example.com",
        role: "program_staff",
      })
    ).toBeDefined()
    expect(
      validateManageAdminRequest({
        action: "setRole",
        email: "a@example.com",
        role: "full_admin",
      })
    ).toBeDefined()
    expect(
      validateManageAdminRequest({
        action: "setDisabled",
        email: "a@example.com",
        disabled: true,
      })
    ).toBeDefined()
    expect(
      validateManageAdminRequest({ action: "remove", email: "a@example.com" })
    ).toBeDefined()
  })

  it("requires role for add/setRole and disabled for setDisabled", () => {
    expectIssue(
      () =>
        validateManageAdminRequest({ action: "add", email: "a@example.com" }),
      "role",
      /required/
    )
    expectIssue(
      () =>
        validateManageAdminRequest({
          action: "setRole",
          email: "a@example.com",
        }),
      "role"
    )
    expectIssue(
      () =>
        validateManageAdminRequest({
          action: "setDisabled",
          email: "a@example.com",
        }),
      "disabled",
      /required/
    )
  })

  it("rejects unknown actions, roles and bad emails", () => {
    expectIssue(
      () =>
        validateManageAdminRequest({
          action: "promote",
          email: "a@example.com",
        }),
      "action"
    )
    expectIssue(
      () =>
        validateManageAdminRequest({
          action: "add",
          email: "a@example.com",
          role: "owner",
        }),
      "role"
    )
    expectIssue(
      () =>
        validateManageAdminRequest({ action: "remove", email: "not-an-email" }),
      "email"
    )
    expectIssue(() => validateManageAdminRequest({ action: "remove" }), "email")
    expectIssue(
      () =>
        validateManageAdminRequest({
          action: "remove",
          email: "a@example.com",
          force: true,
        }),
      "(root)"
    )
  })
})

describe("validateMoveCampersOffWaitlistRequest", () => {
  const request = {
    parentNames: ["Pat Lin", "Sam Lin"],
    parentEmails: ["pat@example.com", "Sam@Example.com"],
    campYear: 2026,
    camperName: "Mei Lin",
    registrationId: "camper1",
    campTrack: CampTrack.YOUNGER,
    isTestData: false,
  }

  it("accepts a valid request", () => {
    expect(validateMoveCampersOffWaitlistRequest(request)).toEqual(request)
  })

  it("rejects bad tracks, ids, emails and missing flags", () => {
    expectIssue(
      () =>
        validateMoveCampersOffWaitlistRequest({
          ...request,
          campTrack: "Middle",
        }),
      "campTrack",
      /Younger/
    )
    expectIssue(
      () =>
        validateMoveCampersOffWaitlistRequest({
          ...request,
          registrationId: "camps/2026/registrations/x",
        }),
      "registrationId"
    )
    expectIssue(
      () =>
        validateMoveCampersOffWaitlistRequest({ ...request, parentEmails: [] }),
      "parentEmails"
    )
    expectIssue(
      () =>
        validateMoveCampersOffWaitlistRequest({
          ...request,
          parentEmails: ["pat"],
        }),
      "parentEmails[0]"
    )
    const { isTestData, ...withoutFlag } = request
    expectIssue(
      () => validateMoveCampersOffWaitlistRequest(withoutFlag),
      "isTestData"
    )
    expectIssue(
      () =>
        validateMoveCampersOffWaitlistRequest({ ...request, campYear: "2026" }),
      "campYear"
    )
  })
})
