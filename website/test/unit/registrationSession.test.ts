import {
  REGISTRATION_STEP_STORAGE_KEY,
  REGISTRATION_STORAGE_KEY,
  RegistrationActionType,
  clearSavedRegistration,
  createEmptyRegistrationData,
  readSavedRegistrationSession,
  registrationReducer,
  saveRegistrationStep,
} from "@components/Registration/RegistrationDataContext"

// The helpers read and write window.localStorage, which the node test
// environment does not have.
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

const savedData = () => {
  const data = createEmptyRegistrationData(2026)
  data.parents = [{ email: "parent@example.com", firstName: "Pat" }]
  data.campers = [{ firstName: "Sam" }, {}]
  data.demographics = [{}, {}]
  return data
}

describe("readSavedRegistrationSession", () => {
  it("returns nothing when no registration is saved", () => {
    expect(readSavedRegistrationSession()).toBeNull()
  })

  it("returns nothing for a visit that never left the Info step", () => {
    // The automatic prefill writes the cache before the family types anything.
    storage.set(REGISTRATION_STORAGE_KEY, JSON.stringify(savedData()))
    expect(readSavedRegistrationSession()).toBeNull()

    saveRegistrationStep(0)
    expect(readSavedRegistrationSession()).toBeNull()
  })

  it("returns the data and the step once the family navigated", () => {
    storage.set(REGISTRATION_STORAGE_KEY, JSON.stringify(savedData()))
    saveRegistrationStep(4)

    const session = readSavedRegistrationSession()
    expect(session?.step).toBe(4)
    expect(session?.data.campers).toHaveLength(2)
    expect(session?.data.parents[0].firstName).toBe("Pat")
  })

  it("ignores a cache that is not a registration", () => {
    saveRegistrationStep(3)
    storage.set(REGISTRATION_STORAGE_KEY, "not json")
    expect(readSavedRegistrationSession()).toBeNull()

    storage.set(REGISTRATION_STORAGE_KEY, JSON.stringify({ campers: "x" }))
    expect(readSavedRegistrationSession()).toBeNull()
  })

  it("ignores a step that is not a positive integer", () => {
    storage.set(REGISTRATION_STORAGE_KEY, JSON.stringify(savedData()))
    storage.set(REGISTRATION_STEP_STORAGE_KEY, "later")
    expect(readSavedRegistrationSession()).toBeNull()
  })
})

describe("clearSavedRegistration", () => {
  it("removes both the data and the step", () => {
    storage.set(REGISTRATION_STORAGE_KEY, JSON.stringify(savedData()))
    saveRegistrationStep(2)

    clearSavedRegistration()

    expect(storage.has(REGISTRATION_STORAGE_KEY)).toBe(false)
    expect(storage.has(REGISTRATION_STEP_STORAGE_KEY)).toBe(false)
  })

  it("is what the ClearData action does", () => {
    saveRegistrationStep(2)
    registrationReducer(savedData(), {
      type: RegistrationActionType.ClearData,
    })

    expect(storage.has(REGISTRATION_STORAGE_KEY)).toBe(false)
    expect(storage.has(REGISTRATION_STEP_STORAGE_KEY)).toBe(false)
  })

  it("leaves the step alone when the reducer saves data", () => {
    saveRegistrationStep(5)
    registrationReducer(savedData(), {
      type: RegistrationActionType.AddCamper,
    })

    expect(storage.get(REGISTRATION_STEP_STORAGE_KEY)).toBe("5")
    expect(readSavedRegistrationSession()?.data.campers).toHaveLength(3)
  })
})
