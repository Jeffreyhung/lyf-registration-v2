import { Camper } from "../src/families"
import { Registration } from "../src/camp"
import {
  getClientRequiredCamperFields,
  getClientRequiredRegistrationFields,
  isEmptyStringOrNullish,
} from "../src/verifier"

describe("isEmptyStringOrNullish", () => {
  it.each([["", true], [null, true], [undefined, true], ["x", false], [" ", false]])(
    "returns %p -> %p",
    (value, expected) => {
      expect(isEmptyStringOrNullish(value)).toBe(expected)
    }
  )
})

describe("getClientRequiredCamperFields", () => {
  const complete: Camper = {
    firstName: "Ada",
    lastName: "Lovelace",
    birthDate: "2012-12-10",
    gender: ["Female"],
  }

  it("returns the required fields when everything is present", () => {
    const result = getClientRequiredCamperFields({
      ...complete,
      // Extra fields are not echoed back.
      preferredName: "Addie",
    })

    expect(result).toEqual({ hasAllFields: true, ...complete })
  })

  it.each([
    ["firstName", "first name"],
    ["lastName", "last name"],
    ["birthDate", "birthday"],
  ] as const)("reports a missing %s", (key, label) => {
    const result = getClientRequiredCamperFields({ ...complete, [key]: "" })

    expect(result).toEqual({
      hasAllFields: false,
      missingFieldKeys: [key],
      missingFields: [label],
    })
  })

  it.each([
    ["undefined", undefined],
    ["empty", []],
  ])("reports gender that is %s", (_label, gender) => {
    const result = getClientRequiredCamperFields({ ...complete, gender })

    expect(result).toEqual({
      hasAllFields: false,
      missingFieldKeys: ["gender"],
      missingFields: ["gender"],
    })
  })

  it("lists every missing field in a stable order", () => {
    expect(getClientRequiredCamperFields({})).toEqual({
      hasAllFields: false,
      missingFieldKeys: ["firstName", "lastName", "birthDate", "gender"],
      missingFields: ["first name", "last name", "birthday", "gender"],
    })
  })
})

describe("getClientRequiredRegistrationFields", () => {
  const complete: Registration = { grade: 6, shirtSize: "M" }

  it("returns the required fields when everything is present", () => {
    expect(
      getClientRequiredRegistrationFields({ ...complete, smallGroup: "A" })
    ).toEqual({ hasAllFields: true, ...complete })
  })

  it("reports a missing grade", () => {
    expect(getClientRequiredRegistrationFields({ shirtSize: "M" })).toEqual({
      hasAllFields: false,
      missingFieldKeys: ["grade"],
      missingFields: ["grade"],
    })
  })

  it("treats grade 0 as missing", () => {
    // Grades start at 1, so a falsy grade is a client bug, not kindergarten.
    expect(
      getClientRequiredRegistrationFields({ grade: 0, shirtSize: "M" })
        .hasAllFields
    ).toBe(false)
  })

  it("reports a missing shirt size", () => {
    expect(getClientRequiredRegistrationFields({ grade: 6, shirtSize: "" })).toEqual({
      hasAllFields: false,
      missingFieldKeys: ["shirtSize"],
      missingFields: ["shirt size"],
    })
  })

  it("lists both when both are missing", () => {
    expect(getClientRequiredRegistrationFields({})).toEqual({
      hasAllFields: false,
      missingFieldKeys: ["grade", "shirtSize"],
      missingFields: ["grade", "shirt size"],
    })
  })
})
