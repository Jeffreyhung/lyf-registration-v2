import {
  CampTrack,
  RegistrationStatus,
  SchemaValidationError,
  validateRegistrationPayload,
  type RegistrationPayload,
} from "lyf-registration-schemas";

// ../utils opens Firestore and Stripe clients at import time; the auth helper
// this module pulls in only touches `db` for admin lookups, which never run here.
jest.mock("../../src/utils", () => ({db: {}}));

import {createOrUpdateRegistration} from "../../src/registration/createOrUpdateRegistration";
import {FakeFirestore} from "./fakeFirestore";

const PARENT = "pat@example.com";
const SITE = "https://lyf-registration.tacl.org/registration";

// What the callable hands over after parseCallablePayload: the website's
// payload with the Firestore leftovers (ids, health) already stripped.
function websitePayload(): RegistrationPayload {
  return validateRegistrationPayload({
    campYear: 2026,
    family: {id: "fam-old", city: "San Jose", state: "CA", zip: "95110", street: "1 Main St"},
    parents: [
      {id: "p1", email: "Pat@Example.com", firstName: "Pat", lastName: "Lin", phoneNumber: "555-0100", subscribeToMailingList: true},
      {firstName: "Sam", lastName: "Lin", email: "", phoneNumber: "555-0101"},
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
        health: {dietAndFoodAllergies: null, medicalConditions: null},
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
      },
    ],
    demographics: [{born: "US", ethnicity: ["Taiwanese"], generation: "2nd"}],
    donation: 25,
    household: {camperMessage: "Have fun", cultureLesson: "Food"},
    joinFamilyId: null,
    successUrl: `${SITE}?success=1`,
    cancelUrl: `${SITE}?success=0`,
    isTestData: false,
  });
}

function setup() {
  return new FakeFirestore().seed("camps", "2026", {
    remainingSpots: {Younger: 2, Older: 0},
  });
}

describe("createOrUpdateRegistration", () => {
  it("writes every document through its validator for a real website payload", async () => {
    const db = setup();

    const {familyRef, parentRefs, camperAndStatuses} =
      await createOrUpdateRegistration(db.as(), websitePayload(), false, PARENT);

    // Family
    const familyId = familyRef.id;
    expect(db.read("families", familyId)).toMatchObject({
      city: "San Jose",
      state: "CA",
      zip: "95110",
      street: "1 Main St",
      household: {camperMessage: "Have fun", cultureLesson: "Food"},
      createdBy: PARENT,
      schemaVersion: 3,
    });

    // Parents: keyed by normalized email, or phone number when there is none.
    expect(parentRefs.map((r) => r.id)).toEqual([PARENT, "555-0101"]);
    expect(db.read(`families/${familyId}/parents`, PARENT)).toMatchObject({
      email: PARENT,
      firstName: "Pat",
      subscribeToMailingList: true,
    });
    expect(db.read(`families/${familyId}/parents`, "555-0101")).toMatchObject({
      email: "",
      firstName: "Sam",
    });

    // Camper and its private sub-documents
    const campers = `families/${familyId}/campers`;
    expect(db.read(campers, "camper1")).toMatchObject({
      firstName: "Mei",
      lastName: "Lin",
      preferredName: null,
      birthDate: "2014-05-06",
      gender: ["Female"],
      pronouns: "she/her",
      schemaVersion: 3,
    });
    expect(db.read(`${campers}/camper1/private`, "health")).toEqual({
      dietAndFoodAllergies: "Peanuts",
      medicalConditions: null,
    });
    expect(db.read(`${campers}/camper1/private`, "demographics")).toEqual({
      born: "US",
      ethnicity: ["Taiwanese"],
      generation: "2nd",
    });

    // Registration (deterministic id = camper id), reserved against capacity
    expect(camperAndStatuses).toEqual([
      expect.objectContaining({
        camperName: "Mei Lin",
        campTrack: CampTrack.YOUNGER,
        isWaitlisted: false,
        status: RegistrationStatus.PENDING_PAYMENT,
      }),
    ]);
    const registration = db.read("camps/2026/registrations", "camper1");
    expect(registration).toMatchObject({
      camperName: "Mei Lin",
      campTrack: CampTrack.YOUNGER,
      grade: 6,
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
      shirtSize: "YM",
      isReturning: true,
      cabinPreference: "",
      additionalNotes: null,
      waiverFullName: "Pat Lin",
      firstName: "Mei",
      lastName: "Lin",
      preferredName: null,
      birthDate: "2014-05-06",
      gender: ["Female"],
      pronouns: "she/her",
      parentContacts: [
        {firstName: "Pat", lastName: "Lin", email: PARENT, phoneNumber: "555-0100"},
        {firstName: "Sam", lastName: "Lin", email: "", phoneNumber: "555-0101"},
      ],
      familyEmails: [PARENT],
      isTestData: false,
      schemaVersion: 3,
    });
    expect((registration?.camper as {path: string}).path).toBe(`${campers}/camper1`);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 0});
  });

  it("waitlists every camper when forced and leaves capacity alone", async () => {
    const db = setup();

    const {camperAndStatuses} = await createOrUpdateRegistration(
      db.as(),
      websitePayload(),
      true,
      PARENT
    );

    expect(camperAndStatuses[0]).toMatchObject({
      isWaitlisted: true,
      status: RegistrationStatus.WAITLIST,
    });
    expect(db.read("camps/2026/registrations", "camper1")).toMatchObject({
      status: RegistrationStatus.WAITLIST,
      spotReserved: false,
    });
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });

  it("refuses a write with a wrongly typed field before it reaches Firestore", async () => {
    const db = setup();
    const payload = websitePayload();
    // Bypass the payload validator (as a future caller might) with a
    // demographics entry whose ethnicity is a string instead of a list.
    payload.demographics = [{ethnicity: "Taiwanese"} as never];

    let caught: unknown;
    try {
      await createOrUpdateRegistration(db.as(), payload, false, PARENT);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SchemaValidationError);
    expect((caught as SchemaValidationError).message).toMatch(/Demographics write/);
    expect((caught as SchemaValidationError).message).toMatch(/ethnicity/);
    // The registration transaction never ran.
    expect(db.read("camps/2026/registrations", "camper1")).toBeUndefined();
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });

  it("refuses a camper field with the wrong type before it reaches Firestore", async () => {
    const db = setup();
    const payload = websitePayload();
    payload.campers[0].firstName = 42 as unknown as string;

    let caught: unknown;
    try {
      await createOrUpdateRegistration(db.as(), payload, false, PARENT);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SchemaValidationError);
    expect((caught as SchemaValidationError).message).toMatch(/Camper write/);
    expect((caught as SchemaValidationError).message).toMatch(/firstName/);
  });
});
