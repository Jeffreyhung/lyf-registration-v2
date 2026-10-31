import type { DocumentReference } from "firebase/firestore"
import { Camper, Family, Parent, RegistrationStatus } from "lyf-registration-schemas"

import {
  RegistrationActionType,
  RegistrationData,
  createEmptyRegistrationData,
  registrationReducer,
} from "@components/Registration/RegistrationDataContext"
import type { DocumentIdWithType, FamilyData } from "@hooks/useFamilyData"

// The reducer persists every state to window.localStorage, which the node
// test environment does not have.
const storage = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value))
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
}

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageStub },
    configurable: true,
    writable: true,
  })
})

afterAll(() => {
  delete (globalThis as { window?: unknown }).window
})

beforeEach(() => storage.clear())

const persisted = () => JSON.parse(storage.get("registration") ?? "null")

// Only the field names are read from references, never the Firestore API.
const ref = <T>() => ({ path: "stub" }) as unknown as DocumentReference<T>

const empty = () => createEmptyRegistrationData(2026)

describe("createEmptyRegistrationData", () => {
  it("starts with one blank parent, camper and demographics entry", () => {
    expect(empty()).toEqual({
      campYear: 2026,
      family: {},
      parents: [{}],
      campers: [{}],
      demographics: [{}],
      household: {},
      donation: 0,
      joinFamilyId: null,
    })
  })
})

describe("registrationReducer", () => {
  it("persists every state change and never mutates the previous state", () => {
    const before = empty()
    const after = registrationReducer(before, {
      type: RegistrationActionType.AddParent,
    })
    expect(after.parents).toEqual([{}, {}])
    expect(before.parents).toEqual([{}])
    expect(persisted()).toEqual(after)
  })

  it("AddCamper adds a camper and a matching demographics entry", () => {
    const after = registrationReducer(empty(), {
      type: RegistrationActionType.AddCamper,
    })
    expect(after.campers).toHaveLength(2)
    expect(after.demographics).toHaveLength(2)
  })

  it("edits one key of the family, household, parent, camper or demographics", () => {
    let state = registrationReducer(empty(), {
      type: RegistrationActionType.EditFamily,
      keyToChange: "city",
      newValue: "Pasadena",
    })
    state = registrationReducer(state, {
      type: RegistrationActionType.EditHousehold,
      keyToChange: "languageFrequency",
      newValue: "Daily",
    })
    state = registrationReducer(state, {
      type: RegistrationActionType.EditParent,
      index: 0,
      keyToChange: "email",
      newValue: "grace@example.com",
    })
    state = registrationReducer(state, {
      type: RegistrationActionType.EditCamper,
      index: 0,
      keyToChange: "firstName",
      newValue: "Ada",
    })
    state = registrationReducer(state, {
      type: RegistrationActionType.EditDemographics,
      index: 0,
      keyToChange: "generation",
      newValue: "2nd",
    })
    expect(state.family).toEqual({ city: "Pasadena" })
    expect(state.household).toEqual({ languageFrequency: "Daily" })
    expect(state.parents).toEqual([{ email: "grace@example.com" }])
    expect(state.campers).toEqual([{ firstName: "Ada" }])
    expect(state.demographics).toEqual([{ generation: "2nd" }])
  })

  it("SetNumOfCampers grows and shrinks campers and demographics together", () => {
    const withName = registrationReducer(empty(), {
      type: RegistrationActionType.EditCamper,
      index: 0,
      keyToChange: "firstName",
      newValue: "Ada",
    })
    const three = registrationReducer(withName, {
      type: RegistrationActionType.SetNumOfCampers,
      numOfCampers: 3,
    })
    expect(three.campers).toEqual([{ firstName: "Ada" }, {}, {}])
    expect(three.demographics).toHaveLength(3)

    const one = registrationReducer(three, {
      type: RegistrationActionType.SetNumOfCampers,
      numOfCampers: 1,
    })
    expect(one.campers).toEqual([{ firstName: "Ada" }])
    expect(one.demographics).toHaveLength(1)
  })

  it("removes a parent or a camper by index", () => {
    let state = registrationReducer(empty(), {
      type: RegistrationActionType.EditParent,
      index: 0,
      keyToChange: "firstName",
      newValue: "Grace",
    })
    state = registrationReducer(state, { type: RegistrationActionType.AddParent })
    state = registrationReducer(state, {
      type: RegistrationActionType.RemoveParent,
      index: 0,
    })
    expect(state.parents).toEqual([{}])

    state = registrationReducer(state, { type: RegistrationActionType.AddCamper })
    state = registrationReducer(state, {
      type: RegistrationActionType.EditCamper,
      index: 1,
      keyToChange: "firstName",
      newValue: "Bea",
    })
    state = registrationReducer(state, {
      type: RegistrationActionType.RemoveCamper,
      index: 0,
    })
    expect(state.campers).toEqual([{ firstName: "Bea" }])
    expect(state.demographics).toHaveLength(1)
  })

  it("sets the donation and the family to join", () => {
    let state = registrationReducer(empty(), {
      type: RegistrationActionType.SetDonation,
      donation: 25,
    })
    expect(state.donation).toBe(25)
    state = registrationReducer(state, {
      type: RegistrationActionType.SetJoinFamily,
      joinFamilyId: "family-1",
    })
    expect(state.joinFamilyId).toBe("family-1")
    state = registrationReducer(state, {
      type: RegistrationActionType.SetJoinFamily,
      joinFamilyId: null,
    })
    expect(state.joinFamilyId).toBeNull()
  })

  it("ClearData resets the form and drops the cached copy", () => {
    const dirty = registrationReducer(empty(), {
      type: RegistrationActionType.SetDonation,
      donation: 25,
    })
    expect(storage.has("registration")).toBe(true)
    const cleared = registrationReducer(dirty, {
      type: RegistrationActionType.ClearData,
    })
    expect(cleared).toEqual(empty())
    expect(storage.has("registration")).toBe(false)
  })

  describe("LoadFromCache", () => {
    it("restores whatever is in localStorage", () => {
      const cached: RegistrationData = { ...empty(), donation: 40 }
      storage.set("registration", JSON.stringify(cached))
      expect(
        registrationReducer(empty(), {
          type: RegistrationActionType.LoadFromCache,
        })
      ).toEqual(cached)
    })

    it("keeps the current state when the cache is empty or unparseable", () => {
      const state = empty()
      expect(
        registrationReducer(state, {
          type: RegistrationActionType.LoadFromCache,
        })
      ).toBe(state)

      storage.set("registration", "{not json")
      expect(
        registrationReducer(state, {
          type: RegistrationActionType.LoadFromCache,
        })
      ).toBe(state)
    })
  })

  describe("prefill", () => {
    it("PrefillParent copies the document without its Firestore fields", () => {
      const parent: DocumentIdWithType<Parent> = {
        ref: ref<Parent>(),
        id: "parent-1",
        stripeCustomerId: "cus_123",
        firstName: "Grace",
        email: "grace@example.com",
      }
      const state = registrationReducer(empty(), {
        type: RegistrationActionType.PrefillParent,
        index: 0,
        parent,
      })
      expect(state.parents).toEqual([
        { firstName: "Grace", email: "grace@example.com" },
      ])
    })

    it("PrefillCamper strips the reference and registrations and merges demographics", () => {
      const camper: DocumentIdWithType<Camper> & {
        demographics?: Record<string, string>
      } = {
        ref: ref<Camper>(),
        id: "camper-1",
        firstName: "Ada",
        registrations: [ref()],
        demographics: { generation: "2nd" },
      }
      const state = registrationReducer(empty(), {
        type: RegistrationActionType.PrefillCamper,
        index: 0,
        camper,
      })
      expect(state.campers).toEqual([{ id: "camper-1", firstName: "Ada" }])
      expect(state.demographics).toEqual([{ generation: "2nd" }])
    })

    it("PrefillFamily copies the document without its reference", () => {
      const family: DocumentIdWithType<Family> = {
        ref: ref<Family>(),
        id: "family-1",
        city: "Pasadena",
      }
      const state = registrationReducer(empty(), {
        type: RegistrationActionType.PrefillFamily,
        family,
      })
      expect(state.family).toEqual({ id: "family-1", city: "Pasadena" })
    })
  })

  it("LoadPendingPaymentRegistrations loads this year's pending registrations", () => {
    const family: DocumentIdWithType<Family> = {
      ref: ref<Family>(),
      id: "family-1",
      city: "Pasadena",
      emails: ["grace@example.com"],
    }
    const camperRef = (id: string) =>
      ({ id }) as unknown as DocumentReference<Camper>
    const familyData: FamilyData = {
      family,
      parents: [{ ref: ref<Parent>(), id: "parent-1", firstName: "Grace" }],
      campers: [
        { ref: ref<Camper>(), id: "camper-1", firstName: "Ada", health: {} },
        { ref: ref<Camper>(), id: "camper-2", firstName: "Bea", health: {} },
      ],
      registrations: new Map([
        [
          "camps/2026/registrations/r1",
          {
            ref: ref(),
            id: "r1",
            camperId: "camper-1",
            campYear: "2026",
            waitlistPosition: null,
            camper: camperRef("camper-1"),
            status: RegistrationStatus.PENDING_PAYMENT,
            grade: 7,
            shirtSize: "M",
          },
        ],
        [
          // Another camp year: ignored.
          "camps/2025/registrations/r2",
          {
            ref: ref(),
            id: "r2",
            camperId: "camper-2",
            campYear: "2025",
            waitlistPosition: null,
            camper: camperRef("camper-2"),
            status: RegistrationStatus.PENDING_PAYMENT,
          },
        ],
        [
          // Already paid: ignored.
          "camps/2026/registrations/r3",
          {
            ref: ref(),
            id: "r3",
            camperId: "camper-2",
            campYear: "2026",
            waitlistPosition: null,
            camper: camperRef("camper-2"),
            status: RegistrationStatus.ACTIVE,
          },
        ],
      ]),
      campCredit: 0,
    }

    const state = registrationReducer(empty(), {
      type: RegistrationActionType.LoadPendingPaymentRegistrations,
      campYear: 2026,
      familyData,
    })

    expect(state.family).toEqual({ id: "family-1", city: "Pasadena" })
    expect(state.parents).toEqual([{ id: "parent-1", firstName: "Grace" }])
    expect(state.campers).toHaveLength(1)
    expect(state.campers[0]).toMatchObject({
      id: "camper-1",
      firstName: "Ada",
      grade: 7,
      shirtSize: "M",
      status: RegistrationStatus.PENDING_PAYMENT,
    })
    expect(state.campers[0]).not.toHaveProperty("ref")
    expect(state.campers[0]).not.toHaveProperty("registrations")
    expect(state.demographics).toHaveLength(1)
  })

  it("throws on an unknown action", () => {
    expect(() =>
      registrationReducer(empty(), {
        type: 99 as RegistrationActionType,
      })
    ).toThrow("Unknown action: 99")
  })
})
