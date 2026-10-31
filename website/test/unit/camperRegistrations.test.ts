import { initializeApp } from "firebase/app"
import { doc, getFirestore } from "firebase/firestore"

import { camperRegistrationRefs } from "@utils/camperRegistrations"

// Building references needs a Firestore instance; nothing here talks to a
// backend, so an app with a throwaway project id is enough.
const firestore = getFirestore(
  initializeApp({ projectId: "demo-lyf" }, "camperRegistrations.test")
)
const camperPath = "families/family1/campers/camper1"
const regA = doc(firestore, "camps/2026/registrations/camper1")
const regB = doc(firestore, "camps/2025/registrations/abc123")

describe("camperRegistrationRefs", () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it("returns the references of a well-formed array unchanged", () => {
    expect(camperRegistrationRefs([regA, regB], camperPath)).toEqual([
      regA,
      regB,
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it("treats a missing field as a camper who has never registered", () => {
    expect(camperRegistrationRefs(undefined, camperPath)).toEqual([])
    expect(camperRegistrationRefs(null, camperPath)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it("drops entries that are not document references and warns once", () => {
    // The shape that triggered LYF-REGISTRATION-1E: a string path stored
    // where a reference belongs, alongside other non-reference junk.
    const malformed = [
      "/camps/2026/registrations/camper1",
      regA,
      null,
      { id: "camper1", path: "camps/2026/registrations/camper1" },
    ]
    expect(camperRegistrationRefs(malformed, camperPath)).toEqual([regA])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(camperPath)
    expect(warn.mock.calls[0][0]).toContain("3")
  })

  it("ignores a field that is not an array", () => {
    expect(
      camperRegistrationRefs("camps/2026/registrations/x", camperPath)
    ).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
