/**
 * Role × collection matrix for firestore.rules.
 *
 * Run with the emulator:  yarn workspace firestore-rules-tests test:emulator
 * (or start `firebase emulators:start --only firestore` and run `yarn test`).
 *
 * Mirrors ROLE_CAPABILITIES in schemas/src/admin.ts — when a capability or
 * rule changes, the corresponding case here should change with it.
 */
import { readFileSync } from "fs"
import { resolve } from "path"
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore"

// ---- Fixtures ----

const FULL = "full@tacl.org"
const PROGRAM = "program@tacl.org"
const PROGRAM_ADMIN = "programadmin@tacl.org"
const HEALTH = "health@tacl.org"
const DISABLED = "disabled@tacl.org"
const BAD_ROLE = "badrole@tacl.org"
const PARENT = "parent@example.com"
const OTHER_PARENT = "other@example.com"

const FAMILY = "families/fam1"
const CAMPER = `${FAMILY}/campers/cam1`
const CAMPER_HEALTH = `${CAMPER}/private/health`
const CAMPER_DEMOGRAPHICS = `${CAMPER}/private/demographics`
const OTHER_FAMILY = "families/fam2"
const CAMP = "camps/2026"
const BYPASS = `${CAMP}/private/bypass/emails`
const SITE_CONFIG = "config/site"
const REGISTRATION = `${CAMP}/registrations/reg1`

let testEnv: RulesTestEnvironment

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const admins: Record<string, object> = {
      [FULL]: { role: "full_admin" },
      [PROGRAM]: { role: "program_staff" },
      [PROGRAM_ADMIN]: { role: "program_admin" },
      [HEALTH]: { role: "health_staff" },
      [DISABLED]: { role: "full_admin", disabled: true },
      [BAD_ROLE]: { role: "superuser" },
    }
    for (const [email, data] of Object.entries(admins)) {
      await setDoc(doc(db, "admins", email), data)
    }

    await setDoc(doc(db, FAMILY), {
      emails: [PARENT],
      street: "1 Main St",
      registrations: [],
    })
    await setDoc(doc(db, `${FAMILY}/parents/p1`), { email: PARENT })
    await setDoc(doc(db, CAMPER), {
      firstName: "Cam",
      lastName: "Per",
      registrations: [doc(db, REGISTRATION)],
    })
    await setDoc(doc(db, CAMPER_HEALTH), { medicalConditions: "none" })
    await setDoc(doc(db, CAMPER_DEMOGRAPHICS), { born: "US" })

    await setDoc(doc(db, OTHER_FAMILY), { emails: [OTHER_PARENT] })
    await setDoc(doc(db, `${OTHER_FAMILY}/campers/cam2`), { firstName: "Other" })

    await setDoc(doc(db, CAMP), { registrationFee: 100 })
    await setDoc(doc(db, SITE_CONFIG), { currentCampYear: 2026, preRegistrationCampYear: 2027 })
    await setDoc(doc(db, "config/other"), { secret: true })
    await setDoc(doc(db, `${BYPASS}/${PARENT}`), { email: PARENT, addedBy: FULL })
    await setDoc(doc(db, `${BYPASS}/late@example.com`), { email: "late@example.com", addedBy: FULL })
    await setDoc(doc(db, REGISTRATION), {
      camper: doc(db, CAMPER),
      familyEmails: [PARENT],
      status: "Active",
      shirtSize: "M",
    })

    await setDoc(doc(db, "payments/pay1"), { total: 100 })
    await setDoc(doc(db, "credits/fam1"), { amountRemaining: 50 })
    await setDoc(doc(db, "_processedEvents/evt1"), { type: "test" })
    await setDoc(doc(db, "adminAuditLog/log1"), { action: "add" })
  })
}

const as = (email: string | null) =>
  email
    ? testEnv.authenticatedContext(email.replace(/[^a-z0-9]/gi, "_"), { email }).firestore()
    : testEnv.unauthenticatedContext().firestore()

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-lyf-rules",
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await seed()
})

afterAll(async () => {
  await testEnv.cleanup()
})

// ---- Admin roster ----

describe("admins/", () => {
  test("a signed-in user can read their own admin doc (even if absent)", async () => {
    await assertSucceeds(getDoc(doc(as(PARENT), "admins", PARENT)))
    await assertSucceeds(getDoc(doc(as(PROGRAM), "admins", PROGRAM)))
  })

  test("only full_admin can read other admin docs / list the roster", async () => {
    await assertSucceeds(getDoc(doc(as(FULL), "admins", PROGRAM)))
    await assertSucceeds(getDocs(collection(as(FULL), "admins")))
    await assertFails(getDoc(doc(as(PROGRAM), "admins", FULL)))
    await assertFails(getDoc(doc(as(PROGRAM_ADMIN), "admins", FULL)))
    await assertFails(getDocs(collection(as(PROGRAM_ADMIN), "admins")))
    await assertFails(getDoc(doc(as(HEALTH), "admins", FULL)))
    await assertFails(getDoc(doc(as(PARENT), "admins", FULL)))
    await assertFails(getDoc(doc(as(null), "admins", FULL)))
  })

  test("nobody can write the roster from the client — not even full_admin", async () => {
    await assertFails(setDoc(doc(as(FULL), "admins", "new@tacl.org"), { role: "program_staff" }))
    await assertFails(updateDoc(doc(as(FULL), "admins", PROGRAM), { role: "full_admin" }))
    await assertFails(deleteDoc(doc(as(FULL), "admins", PROGRAM)))
    await assertFails(updateDoc(doc(as(PROGRAM), "admins", PROGRAM), { role: "full_admin" }))
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), "admins", PROGRAM_ADMIN), { role: "full_admin" }))
    await assertFails(setDoc(doc(as(PROGRAM_ADMIN), "admins", "new@tacl.org"), { role: "program_staff" }))
  })

  test("fails closed: disabled admins and unrecognized roles get no admin access", async () => {
    await assertFails(getDocs(collection(as(DISABLED), "admins")))
    await assertFails(getDoc(doc(as(DISABLED), FAMILY)))
    await assertFails(getDoc(doc(as(BAD_ROLE), FAMILY)))
    await assertFails(getDoc(doc(as(BAD_ROLE), CAMPER_HEALTH)))
  })
})

// ---- Families ----

describe("families/", () => {
  test("family members and any admin role can read; others cannot", async () => {
    await assertSucceeds(getDoc(doc(as(PARENT), FAMILY)))
    await assertSucceeds(getDoc(doc(as(FULL), FAMILY)))
    await assertSucceeds(getDoc(doc(as(PROGRAM), FAMILY)))
    await assertSucceeds(getDoc(doc(as(HEALTH), FAMILY)))
    await assertFails(getDoc(doc(as(OTHER_PARENT), FAMILY)))
    await assertFails(getDoc(doc(as(null), FAMILY)))
  })

  test("family members may edit address fields only", async () => {
    await assertSucceeds(updateDoc(doc(as(PARENT), FAMILY), { street: "2 Main St", city: "SF" }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { emails: [PARENT, "attacker@x.com"] }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { registrations: [doc(as(PARENT), REGISTRATION)] }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { isTestData: true }))
    await assertFails(updateDoc(doc(as(OTHER_PARENT), FAMILY), { street: "x" }))
  })

  test("family members cannot create or delete families", async () => {
    await assertFails(setDoc(doc(as(PARENT), "families/new"), { emails: [PARENT] }))
    await assertFails(deleteDoc(doc(as(PARENT), FAMILY)))
  })

  test("only full_admin writes families; program/health staff are read-only", async () => {
    await assertSucceeds(updateDoc(doc(as(FULL), FAMILY), { emails: [PARENT, "co@x.com"] }))
    await assertFails(updateDoc(doc(as(PROGRAM), FAMILY), { street: "x" }))
    await assertFails(updateDoc(doc(as(HEALTH), FAMILY), { street: "x" }))
  })

  test("parents sub-collection: readable by family + admins, writable by full_admin only", async () => {
    await assertSucceeds(getDoc(doc(as(PARENT), `${FAMILY}/parents/p1`)))
    await assertSucceeds(getDoc(doc(as(PROGRAM), `${FAMILY}/parents/p1`)))
    await assertFails(getDoc(doc(as(OTHER_PARENT), `${FAMILY}/parents/p1`)))
    await assertFails(updateDoc(doc(as(PARENT), `${FAMILY}/parents/p1`), { phoneNumber: "1" }))
    await assertSucceeds(updateDoc(doc(as(FULL), `${FAMILY}/parents/p1`), { phoneNumber: "1" }))
  })
})

// ---- Campers ----

describe("families/{id}/campers/", () => {
  const profile = { firstName: "New", lastName: "Kid", birthDate: "2015-01-01", gender: ["Female"], registrations: [] }

  test("family members can add a camper with profile fields", async () => {
    await assertSucceeds(addDoc(collection(as(PARENT), `${FAMILY}/campers`), profile))
  })

  test("a new camper cannot carry health fields or pre-attached registrations", async () => {
    await assertFails(
      addDoc(collection(as(PARENT), `${FAMILY}/campers`), { ...profile, medicalConditions: "x" })
    )
    await assertFails(
      addDoc(collection(as(PARENT), `${FAMILY}/campers`), { ...profile, dietAndFoodAllergies: "x" })
    )
    await assertFails(
      addDoc(collection(as(PARENT), `${FAMILY}/campers`), {
        ...profile,
        registrations: [doc(as(PARENT), REGISTRATION)],
      })
    )
  })

  test("family members can edit profile fields but not health, registrations, or system fields", async () => {
    await assertSucceeds(updateDoc(doc(as(PARENT), CAMPER), { preferredName: "C" }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { medicalConditions: "leak" }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { registrations: [] }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { isTestData: true }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { schemaVersion: 99 }))
  })

  test("other families cannot touch the camper; admins can read", async () => {
    await assertFails(getDoc(doc(as(OTHER_PARENT), CAMPER)))
    await assertFails(updateDoc(doc(as(OTHER_PARENT), CAMPER), { firstName: "x" }))
    await assertFails(addDoc(collection(as(OTHER_PARENT), `${FAMILY}/campers`), profile))
    await assertSucceeds(getDoc(doc(as(PROGRAM), CAMPER)))
    await assertSucceeds(getDoc(doc(as(HEALTH), CAMPER)))
  })

  test("program/health staff cannot write campers; full_admin can", async () => {
    await assertFails(updateDoc(doc(as(PROGRAM), CAMPER), { firstName: "x" }))
    await assertFails(updateDoc(doc(as(HEALTH), CAMPER), { firstName: "x" }))
    await assertSucceeds(updateDoc(doc(as(FULL), CAMPER), { firstName: "x" }))
  })
})

// ---- Private sections ----

describe("campers/{id}/private/health", () => {
  test("readable by health_staff, full_admin, and the family — not program_staff or others", async () => {
    await assertSucceeds(getDoc(doc(as(HEALTH), CAMPER_HEALTH)))
    await assertSucceeds(getDoc(doc(as(FULL), CAMPER_HEALTH)))
    await assertSucceeds(getDoc(doc(as(PARENT), CAMPER_HEALTH)))
    await assertFails(getDoc(doc(as(PROGRAM), CAMPER_HEALTH)))
    await assertFails(getDoc(doc(as(PROGRAM_ADMIN), CAMPER_HEALTH)))
    await assertFails(getDoc(doc(as(OTHER_PARENT), CAMPER_HEALTH)))
    await assertFails(getDoc(doc(as(null), CAMPER_HEALTH)))
  })

  test("family may update health fields only; staff other than full_admin cannot write", async () => {
    await assertSucceeds(
      setDoc(doc(as(PARENT), CAMPER_HEALTH), { dietAndFoodAllergies: "nuts" }, { merge: true })
    )
    await assertFails(
      setDoc(doc(as(PARENT), CAMPER_HEALTH), { medicalConditions: "x", extra: true }, { merge: true })
    )
    await assertFails(updateDoc(doc(as(HEALTH), CAMPER_HEALTH), { medicalConditions: "x" }))
    await assertFails(updateDoc(doc(as(PROGRAM), CAMPER_HEALTH), { medicalConditions: "x" }))
    await assertSucceeds(updateDoc(doc(as(FULL), CAMPER_HEALTH), { medicalConditions: "x" }))
  })
})

describe("campers/{id}/private/demographics", () => {
  test("full_admin only, in both directions", async () => {
    await assertSucceeds(getDoc(doc(as(FULL), CAMPER_DEMOGRAPHICS)))
    await assertSucceeds(updateDoc(doc(as(FULL), CAMPER_DEMOGRAPHICS), { born: "TW" }))
    await assertFails(getDoc(doc(as(HEALTH), CAMPER_DEMOGRAPHICS)))
    await assertFails(getDoc(doc(as(PROGRAM), CAMPER_DEMOGRAPHICS)))
    await assertFails(getDoc(doc(as(PROGRAM_ADMIN), CAMPER_DEMOGRAPHICS)))
    await assertFails(getDoc(doc(as(PARENT), CAMPER_DEMOGRAPHICS)))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER_DEMOGRAPHICS), { born: "x" }))
    await assertFails(setDoc(doc(as(PARENT), `${CAMPER}/private/other`), { secret: 1 }))
  })
})

// ---- Camps & registrations ----

describe("config/", () => {
  test("site config is readable by anyone, signed in or not", async () => {
    await assertSucceeds(getDoc(doc(as(null), SITE_CONFIG)))
    await assertSucceeds(getDoc(doc(as(PARENT), SITE_CONFIG)))
    await assertSucceeds(getDoc(doc(as(PROGRAM_ADMIN), SITE_CONFIG)))
    await assertSucceeds(getDoc(doc(as(FULL), SITE_CONFIG)))
  })

  test("nobody writes config from the client — manageCampYear is the only path", async () => {
    await assertFails(updateDoc(doc(as(FULL), SITE_CONFIG), { currentCampYear: 2027 }))
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), SITE_CONFIG), { currentCampYear: 2027 }))
    await assertFails(updateDoc(doc(as(PROGRAM), SITE_CONFIG), { currentCampYear: 2027 }))
    await assertFails(updateDoc(doc(as(PARENT), SITE_CONFIG), { currentCampYear: 2027 }))
    await assertFails(setDoc(doc(as(FULL), "config/other"), { a: 1 }))
    await assertFails(deleteDoc(doc(as(FULL), SITE_CONFIG)))
  })

  test("only config/site is public; other config docs fall to the catch-all", async () => {
    await assertFails(getDoc(doc(as(null), "config/other")))
    await assertFails(getDoc(doc(as(PARENT), "config/other")))
    await assertFails(getDoc(doc(as(PROGRAM_ADMIN), "config/other")))
    await assertSucceeds(getDoc(doc(as(FULL), "config/other")))
  })
})

describe("camps/{year}/private/bypass/emails/", () => {
  test("a parent can read only their own entry", async () => {
    await assertSucceeds(getDoc(doc(as(PARENT), `${BYPASS}/${PARENT}`)))
    await assertFails(getDoc(doc(as(PARENT), `${BYPASS}/late@example.com`)))
    await assertFails(getDocs(collection(as(PARENT), BYPASS)))
    await assertFails(getDoc(doc(as(OTHER_PARENT), `${BYPASS}/${PARENT}`)))
    await assertFails(getDoc(doc(as(null), `${BYPASS}/${PARENT}`)))
    await assertFails(getDocs(collection(as(null), BYPASS)))
  })

  test("every admin role can read and list the bypass entries", async () => {
    for (const admin of [FULL, PROGRAM_ADMIN, PROGRAM, HEALTH]) {
      await assertSucceeds(getDoc(doc(as(admin), `${BYPASS}/late@example.com`)))
      await assertSucceeds(getDocs(collection(as(admin), BYPASS)))
    }
    await assertFails(getDocs(collection(as(DISABLED), BYPASS)))
  })

  test("nobody writes bypass entries from the client — manageCampYear is the only path", async () => {
    await assertFails(setDoc(doc(as(FULL), `${BYPASS}/new@example.com`), { email: "new@example.com" }))
    await assertFails(setDoc(doc(as(PROGRAM_ADMIN), `${BYPASS}/new@example.com`), { email: "new@example.com" }))
    await assertFails(setDoc(doc(as(PARENT), `${BYPASS}/${PARENT}`), { email: PARENT }))
    await assertFails(deleteDoc(doc(as(FULL), `${BYPASS}/${PARENT}`)))
    await assertFails(deleteDoc(doc(as(PARENT), `${BYPASS}/${PARENT}`)))
  })

  test("other private paths under a camp fall to the catch-all (full_admin inspect only)", async () => {
    await assertSucceeds(getDoc(doc(as(FULL), `${CAMP}/private/bypass`)))
    await assertFails(getDoc(doc(as(PROGRAM_ADMIN), `${CAMP}/private/bypass`)))
    await assertFails(getDoc(doc(as(PARENT), `${CAMP}/private/other`)))
    await assertFails(setDoc(doc(as(FULL), `${CAMP}/private/other`), { a: 1 }))
  })
})

describe("camps/{year}", () => {
  test("camp info is readable by anyone, signed in or not", async () => {
    await assertSucceeds(getDoc(doc(as(null), CAMP)))
    await assertSucceeds(getDoc(doc(as(PARENT), CAMP)))
    await assertSucceeds(getDoc(doc(as(PROGRAM), CAMP)))
  })

  test("nobody writes camp info from the client — manageCampYear is the only path", async () => {
    await assertFails(updateDoc(doc(as(FULL), CAMP), { registrationFee: 200 }))
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), CAMP), { registrationFee: 200 }))
    await assertFails(updateDoc(doc(as(PROGRAM), CAMP), { registrationFee: 200 }))
    await assertFails(updateDoc(doc(as(PARENT), CAMP), { registrationFee: 0 }))
    await assertFails(updateDoc(doc(as(FULL), CAMP), { remainingSpots: { Younger: 999 } }))
    await assertFails(setDoc(doc(as(FULL), "camps/2027"), { registrationFee: 1 }))
    await assertFails(deleteDoc(doc(as(FULL), CAMP)))
  })
})

describe("camps/{year}/registrations/", () => {
  test("readable by every admin role and by the owning family only", async () => {
    await assertSucceeds(getDoc(doc(as(FULL), REGISTRATION)))
    await assertSucceeds(getDoc(doc(as(PROGRAM), REGISTRATION)))
    await assertSucceeds(getDoc(doc(as(HEALTH), REGISTRATION)))
    await assertSucceeds(getDoc(doc(as(PARENT), REGISTRATION)))
    await assertFails(getDoc(doc(as(OTHER_PARENT), REGISTRATION)))
    await assertFails(getDoc(doc(as(null), REGISTRATION)))
  })

  test("family may edit shirt size / notes / checkout, nothing structural", async () => {
    await assertSucceeds(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: "L", additionalNotes: "hi" }))
    await assertSucceeds(
      updateDoc(doc(as(PARENT), REGISTRATION), { isCheckedOut: true, nameOfParentCheckedOut: "P" })
    )
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { status: "Cancelled" }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { familyEmails: [PARENT, OTHER_PARENT] }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { payments: [] }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { internalNotes: "x" }))
    await assertFails(updateDoc(doc(as(OTHER_PARENT), REGISTRATION), { shirtSize: "L" }))
  })

  test("program_staff (writeRegistrations) may edit operational fields only", async () => {
    await assertSucceeds(
      updateDoc(doc(as(PROGRAM), REGISTRATION), { status: "Cancelled", internalNotes: "x", smallGroup: "A" })
    )
    await assertFails(updateDoc(doc(as(PROGRAM), REGISTRATION), { familyEmails: [PROGRAM] }))
    await assertFails(
      updateDoc(doc(as(PROGRAM), REGISTRATION), { camper: doc(as(PROGRAM), `${OTHER_FAMILY}/campers/cam2`) })
    )
    await assertFails(updateDoc(doc(as(PROGRAM), REGISTRATION), { payments: [] }))
    await assertFails(setDoc(doc(as(PROGRAM), `${CAMP}/registrations/new`), { status: "Active" }))
    await assertFails(deleteDoc(doc(as(PROGRAM), REGISTRATION)))
  })

  test("program_admin (writeRegistrations) has the same operational-field access as program_staff", async () => {
    await assertSucceeds(getDoc(doc(as(PROGRAM_ADMIN), REGISTRATION)))
    await assertSucceeds(
      updateDoc(doc(as(PROGRAM_ADMIN), REGISTRATION), {
        status: "Cancelled",
        internalNotes: "x",
        smallGroup: "A",
        cabinPreference: "B",
        hasContacted: true,
      })
    )
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), REGISTRATION), { familyEmails: [PROGRAM_ADMIN] }))
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), REGISTRATION), { payments: [] }))
    await assertFails(updateDoc(doc(as(PROGRAM_ADMIN), REGISTRATION), { waiverSignature: "x" }))
    await assertFails(setDoc(doc(as(PROGRAM_ADMIN), `${CAMP}/registrations/new`), { status: "Active" }))
    await assertFails(deleteDoc(doc(as(PROGRAM_ADMIN), REGISTRATION)))
  })

  test("health_staff has no writeRegistrations capability", async () => {
    await assertFails(updateDoc(doc(as(HEALTH), REGISTRATION), { internalNotes: "x" }))
    await assertFails(updateDoc(doc(as(HEALTH), REGISTRATION), { status: "Cancelled" }))
  })

  test("full_admin has unrestricted write", async () => {
    await assertSucceeds(updateDoc(doc(as(FULL), REGISTRATION), { familyEmails: [PARENT, "co@x.com"] }))
    await assertSucceeds(setDoc(doc(as(FULL), `${CAMP}/registrations/new`), { status: "Active" }))
    await assertSucceeds(deleteDoc(doc(as(FULL), REGISTRATION)))
  })
})

// ---- Money ----

describe("payments/ and credits/", () => {
  test("full_admin only", async () => {
    for (const path of ["payments/pay1", "credits/fam1"]) {
      await assertSucceeds(getDoc(doc(as(FULL), path)))
      await assertSucceeds(updateDoc(doc(as(FULL), path), { touched: true }))
      await assertFails(getDoc(doc(as(PROGRAM), path)))
      await assertFails(getDoc(doc(as(HEALTH), path)))
      await assertFails(getDoc(doc(as(PARENT), path)))
      await assertFails(updateDoc(doc(as(PROGRAM), path), { touched: true }))
    }
  })
})

// ---- Catch-all ----

describe("server-only and unknown collections", () => {
  test("full_admin may inspect, nobody writes from the client", async () => {
    for (const path of ["_processedEvents/evt1", "adminAuditLog/log1"]) {
      await assertSucceeds(getDoc(doc(as(FULL), path)))
      await assertFails(updateDoc(doc(as(FULL), path), { tampered: true }))
      await assertFails(deleteDoc(doc(as(FULL), path)))
      await assertFails(getDoc(doc(as(PROGRAM), path)))
      await assertFails(getDoc(doc(as(PARENT), path)))
    }
    await assertFails(setDoc(doc(as(FULL), "brandNew/doc"), { a: 1 }))
    await assertFails(setDoc(doc(as(PROGRAM_ADMIN), "brandNew/doc"), { a: 1 }))
    await assertFails(setDoc(doc(as(PARENT), "brandNew/doc"), { a: 1 }))
  })
})

// ---- Enumeration, anonymous tokens, privilege fields ----

describe("enumeration and identity edge cases", () => {
  test("a parent cannot list every registration or every family, only their own", async () => {
    await assertFails(getDocs(collection(as(PARENT), `${CAMP}/registrations`)))
    await assertSucceeds(
      getDocs(
        query(collection(as(PARENT), `${CAMP}/registrations`), where("familyEmails", "array-contains", PARENT))
      )
    )
    await assertFails(getDocs(collection(as(PARENT), "families")))
    await assertSucceeds(
      getDocs(query(collection(as(PARENT), "families"), where("emails", "array-contains", PARENT)))
    )
    await assertFails(getDocs(collection(as(PARENT), `${OTHER_FAMILY}/campers`)))
    await assertFails(getDocs(collection(as(null), `${CAMP}/registrations`)))
  })

  test("a signed-in account without an email claim is treated like an anonymous visitor", async () => {
    const noEmail = testEnv.authenticatedContext("uid-without-email").firestore()
    await assertSucceeds(getDoc(doc(noEmail, CAMP)))
    await assertSucceeds(getDoc(doc(noEmail, SITE_CONFIG)))
    await assertFails(getDoc(doc(noEmail, FAMILY)))
    await assertFails(getDoc(doc(noEmail, REGISTRATION)))
    await assertFails(getDoc(doc(noEmail, `admins/${FULL}`)))
    await assertFails(getDocs(collection(noEmail, "families")))
  })

  test("parents cannot grant themselves established membership, a spot, or a payment", async () => {
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { confirmedEmails: [PARENT] }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { createdBy: PARENT }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { spotReserved: true }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { amountPaid: 1000 }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { grade: 12, campTrack: "Older" }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { isPreRegistered: true }))
    await assertFails(
      setDoc(doc(as(PARENT), `${CAMP}/registrations/mine`), { familyEmails: [PARENT], status: "Active" })
    )
    await assertFails(deleteDoc(doc(as(PARENT), REGISTRATION)))
  })
})

// ---- Field shapes on parent writes ----

describe("field shapes on parent writes", () => {
  const profile = { firstName: "New", lastName: "Kid", birthDate: "2015-01-01", gender: ["Female"], registrations: [] }

  test("registration: wrong types and oversize values are rejected; normal values and nulls pass", async () => {
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: { big: true } }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: "x".repeat(51) }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { additionalNotes: "x".repeat(5001) }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { isCheckedOut: "yes" }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { checkedOutTime: "now" }))
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { nameOfParentCheckedOut: ["P"] }))
    await assertSucceeds(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: "L", additionalNotes: null }))
    await assertSucceeds(
      updateDoc(doc(as(PARENT), REGISTRATION), {
        isCheckedOut: true,
        nameOfParentCheckedOut: "P",
        checkedOutTime: serverTimestamp(),
      })
    )
  })

  test("a legacy value in an untouched field does not block an unrelated edit", async () => {
    await testEnv.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), REGISTRATION), { shirtSize: 42 })
    )
    await assertSucceeds(updateDoc(doc(as(PARENT), REGISTRATION), { additionalNotes: "fine" }))
    // ...but touching the field itself has to make it well-formed.
    await assertFails(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: 43 }))
    await assertSucceeds(updateDoc(doc(as(PARENT), REGISTRATION), { shirtSize: "M" }))
  })

  test("camper profile: types are enforced on create and update", async () => {
    const campers = collection(as(PARENT), `${FAMILY}/campers`)
    await assertFails(addDoc(campers, { ...profile, gender: "Female" }))
    await assertFails(addDoc(campers, { ...profile, firstName: { first: "New" } }))
    await assertFails(addDoc(campers, { ...profile, firstName: "x".repeat(201) }))
    await assertFails(addDoc(campers, { ...profile, returning: "yes" }))
    await assertSucceeds(addDoc(campers, { ...profile, preferredName: null, returning: false }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { gender: "Male" }))
    await assertFails(updateDoc(doc(as(PARENT), CAMPER), { birthDate: 20150101 }))
    await assertSucceeds(updateDoc(doc(as(PARENT), CAMPER), { preferredName: null, pronouns: "they/them" }))
  })

  test("health: text or null only", async () => {
    await assertFails(setDoc(doc(as(PARENT), CAMPER_HEALTH), { medicalConditions: ["asthma"] }, { merge: true }))
    await assertFails(setDoc(doc(as(PARENT), CAMPER_HEALTH), { dietAndFoodAllergies: "x".repeat(5001) }, { merge: true }))
    await assertSucceeds(setDoc(doc(as(PARENT), CAMPER_HEALTH), { medicalConditions: null }, { merge: true }))
    await assertSucceeds(
      setDoc(doc(as(PARENT), `${FAMILY}/campers/cam1/private/health`), { dietAndFoodAllergies: "peanuts" }, { merge: true })
    )
  })

  test("family address: strings and a household map only", async () => {
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { street: 12 }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { zip: "x".repeat(51) }))
    await assertFails(updateDoc(doc(as(PARENT), FAMILY), { household: "Mandarin" }))
    await assertSucceeds(updateDoc(doc(as(PARENT), FAMILY), { household: { language: "Mandarin" }, suite: null }))
  })
})
