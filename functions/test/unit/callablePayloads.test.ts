/**
 * Every callable validates `request.data` before doing anything else. These
 * tests drive the real handlers (through onCall's `run`) against the fake
 * Firestore with a malformed body and expect `invalid-argument`, and with a
 * well-formed body check that the handler got past validation.
 */
import {CampTrack, RegistrationStatus} from "lyf-registration-schemas";

import {callableRequest, expectHttpsError} from "./callableTestUtils";
import {FakeFirestore} from "./fakeFirestore";

// ../utils opens Firestore, Stripe and the mail transport at import time.
// Replace it with stubs that delegate to the fake database of the current
// test. Only names prefixed with "mock" may be referenced from a hoisted
// jest.mock factory.
const mockState: {db: FakeFirestore} = {db: new FakeFirestore()};
const mockSendMail = jest.fn();
jest.mock("../../src/utils", () => ({
  db: {
    collection: (name: string) => mockState.db.collection(name),
    runTransaction: (fn: never) => mockState.db.runTransaction(fn),
  },
  getFirestoreDb: () => mockState.db,
  getStripe: () => ({}),
  STRIPE_APP_TAG: "v2",
  StripeWebhookEventType: {Registration: 0, PreRegistration: 1, Donation: 2},
  RegistrationType: {PreRegistration: "PreReg", Registration: "Reg"},
  REGISTRATION_EMAIL: "lyf@example.com",
  emailTransport: {sendMail: mockSendMail},
  getFirstName: (name: string) => name.split(" ")[0],
  combineNames: (names: string[]) => names.join(" and "),
  sanitizeForEmailHeader: (value: string) => value.replace(/[\r\n]/g, " ").trim(),
}));
jest.mock("@slack/client", () => ({
  IncomingWebhook: jest.fn().mockImplementation(() => ({send: jest.fn()})),
}));
jest.mock("@mailchimp/mailchimp_marketing", () => ({
  __esModule: true,
  default: {setConfig: jest.fn(), lists: {}},
}));

import {manageAdmin} from "../../src/admin/manageAdmin";
import {createPreRegistrationSession} from "../../src/preRegistration/createPreRegistrationSession";
import {createRegistrationSession} from "../../src/registration/createRegistrationSession";
import {moveCampersOffWaitlist} from "../../src/registration/moveCampersOffWaitlist";

const ADMIN = "root@example.com";
const PARENT = "pat@example.com";
const SITE = "https://lyf-registration.tacl.org/registration";

// Each test speaks as this caller unless it says otherwise.
const request = (data: unknown, email: string | null = PARENT) =>
  callableRequest(data, email);

beforeEach(() => {
  mockState.db = new FakeFirestore();
  mockSendMail.mockReset().mockResolvedValue({accepted: true});
});

// Shaped like what ReviewStep sends, including the Firestore leftovers the
// website spreads into the nested objects (family.id, parents[].id,
// campers[].health, campers[].id).
const registrationPayload = {
  campYear: 2026,
  family: {id: "fam1", city: "San Jose", state: "CA", zip: "95110", street: "1 Main St"},
  parents: [
    {id: "p1", email: "Pat@Example.com", firstName: "Pat", lastName: "Lin", phoneNumber: "555-0100"},
  ],
  campers: [
    {
      id: "camper1",
      firstName: "Mei",
      lastName: "Lin",
      birthDate: "2014-05-06",
      gender: ["Female"],
      health: {dietAndFoodAllergies: null},
      grade: 6,
      campTrack: CampTrack.YOUNGER,
      shirtSize: "YM",
      status: RegistrationStatus.PENDING_PAYMENT,
    },
  ],
  demographics: [{born: "US", ethnicity: ["Taiwanese"]}],
  donation: 0,
  household: {camperMessage: "Have fun"},
  joinFamilyId: null,
  successUrl: `${SITE}?success=1`,
  cancelUrl: `${SITE}?success=0`,
  isTestData: false,
};

describe("createRegistrationSession", () => {
  it("rejects an empty body with invalid-argument", async () => {
    const error = await expectHttpsError(
      createRegistrationSession.run(request({})),
      "invalid-argument"
    );
    expect(error.message).toMatch(/parents/);
    expect(error.message).toMatch(/campers/);
  });

  it.each([
    ["a mistyped top-level key", {...registrationPayload, forcewaitlist: true}, /forcewaitlist/],
    ["no parents", {...registrationPayload, parents: []}, /At least one parent/],
    ["a grade out of range", {...registrationPayload, campers: [{...registrationPayload.campers[0], grade: 99}]}, /campers\[0\]\.grade/],
    ["an unknown camp track", {...registrationPayload, campers: [{...registrationPayload.campers[0], campTrack: "Middle"}]}, /campTrack/],
    ["an unknown status", {...registrationPayload, campers: [{...registrationPayload.campers[0], status: "Paid"}]}, /status/],
    ["a negative donation", {...registrationPayload, donation: -5}, /donation/],
    ["demographics that do not line up with campers", {...registrationPayload, demographics: []}, /demographics/],
    ["a relative redirect URL", {...registrationPayload, successUrl: "/registration"}, /successUrl/],
  ])("rejects %s with invalid-argument", async (_label, data, message) => {
    await expectHttpsError(
      createRegistrationSession.run(request(data)),
      "invalid-argument",
      message
    );
  });

  it("still requires the caller to be signed in before looking at the body", async () => {
    await expectHttpsError(
      createRegistrationSession.run(request({}, null)),
      "unauthenticated"
    );
  });

  it("accepts the website's payload, leftovers included, and moves on to the camp year check", async () => {
    // No camp document is seeded, so the next check after validation fails.
    await expectHttpsError(
      createRegistrationSession.run(request(registrationPayload)),
      "failed-precondition",
      /not open for camp year 2026/
    );
  });

  it("keeps enforcing the redirect-origin allow-list after validation", async () => {
    await expectHttpsError(
      createRegistrationSession.run(
        request({...registrationPayload, successUrl: "https://evil.example.com/x"})
      ),
      "invalid-argument",
      /not allowed/
    );
  });
});

describe("createPreRegistrationSession", () => {
  const payload = {
    campersToPreRegister: ["Mei Lin"],
    camperRefsToPreRegister: ["families/fam1/campers/camper1"],
    camperCurrentGrades: [6],
    campYear: 2027,
    donationAmount: 0,
    email: PARENT,
    successUrl: `${SITE}?success=1`,
    cancelUrl: `${SITE}?success=0`,
    isTestData: false,
  };

  it("rejects an empty body with invalid-argument", async () => {
    await expectHttpsError(
      createPreRegistrationSession.run(request({})),
      "invalid-argument",
      /campersToPreRegister/
    );
  });

  it.each([
    ["mismatched camper lists", {...payload, camperRefsToPreRegister: []}, /camperRefsToPreRegister/],
    ["a collection path instead of a document path", {...payload, camperRefsToPreRegister: ["families/fam1/campers"]}, /camperRefsToPreRegister\[0\]/],
    ["a grade out of range", {...payload, camperCurrentGrades: [99]}, /camperCurrentGrades\[0\]/],
    ["a malformed email", {...payload, email: "pat"}, /email/],
    ["an unknown key", {...payload, coupon: "FREE"}, /coupon/],
  ])("rejects %s with invalid-argument", async (_label, data, message) => {
    await expectHttpsError(
      createPreRegistrationSession.run(request(data)),
      "invalid-argument",
      message
    );
  });

  it("accepts a well-formed payload and moves on to the identity check", async () => {
    await expectHttpsError(
      createPreRegistrationSession.run(request(payload, "someone-else@example.com")),
      "permission-denied",
      /does not match/
    );
  });
});

describe("manageAdmin", () => {
  beforeEach(() => {
    mockState.db.seed("admins", ADMIN, {role: "full_admin"});
  });

  it("rejects an empty body with invalid-argument", async () => {
    const error = await expectHttpsError(
      manageAdmin.run(request({}, ADMIN)),
      "invalid-argument"
    );
    expect(error.message).toMatch(/action/);
    expect(error.message).toMatch(/email/);
  });

  it.each([
    ["an unknown action", {action: "promote", email: "new@example.com"}, /action/],
    ["a malformed email", {action: "add", email: "new", role: "program_staff"}, /email/],
    ["add without a role", {action: "add", email: "new@example.com"}, /role is required/],
    ["an unknown role", {action: "add", email: "new@example.com", role: "superuser"}, /role/],
    ["setDisabled without disabled", {action: "setDisabled", email: ADMIN}, /disabled is required/],
    ["an unknown key", {action: "remove", email: ADMIN, force: true}, /force/],
  ])("rejects %s with invalid-argument", async (_label, data, message) => {
    await expectHttpsError(manageAdmin.run(request(data, ADMIN)), "invalid-argument", message);
  });

  it("checks the caller's permission before the body", async () => {
    await expectHttpsError(manageAdmin.run(request({}, PARENT)), "permission-denied");
  });

  it("writes a validated admin document and audit entry for a well-formed request", async () => {
    await expect(
      manageAdmin.run(
        request({action: "add", email: "New@Example.com", role: "program_staff"}, ADMIN)
      )
    ).resolves.toEqual({status: "success", action: "add", email: "new@example.com"});

    expect(mockState.db.read("admins", "new@example.com")).toMatchObject({
      role: "program_staff",
      addedBy: ADMIN,
      disabled: false,
    });
    const [entry] = [...mockState.db.entries("adminAuditLog")].map(([, data]) => data);
    expect(entry).toMatchObject({
      actor: ADMIN,
      action: "add",
      target: "new@example.com",
      before: null,
      after: {role: "program_staff", addedBy: ADMIN, disabled: false},
    });
  });
});

describe("moveCampersOffWaitlist", () => {
  const REGISTRATIONS = "camps/2026/registrations";
  const payload = {
    parentNames: ["Pat Lin"],
    parentEmails: [PARENT],
    campYear: 2026,
    camperName: "Mei Lin",
    registrationId: "camper1",
    campTrack: "Older",
    isTestData: false,
  };

  beforeEach(() => {
    mockState.db
      .seed("admins", ADMIN, {role: "full_admin"})
      .seed("camps", "2026", {remainingSpots: {Younger: 2, Older: 1}})
      .seed(REGISTRATIONS, "camper1", {status: "Waitlist", campTrack: "Older"});
  });

  it("rejects an empty body with invalid-argument", async () => {
    const error = await expectHttpsError(
      moveCampersOffWaitlist.run(request({}, ADMIN)),
      "invalid-argument"
    );
    expect(error.message).toMatch(/parentEmails/);
    expect(error.message).toMatch(/registrationId/);
  });

  it.each([
    ["no parent emails", {...payload, parentEmails: []}, /parentEmails/],
    ["a malformed parent email", {...payload, parentEmails: ["pat"]}, /parentEmails\[0\]/],
    ["a registration path instead of an id", {...payload, registrationId: `${REGISTRATIONS}/camper1`}, /registrationId/],
    ["an unknown camp track", {...payload, campTrack: "Middle"}, /campTrack/],
    ["a non-boolean isTestData", {...payload, isTestData: "no"}, /isTestData/],
  ])("rejects %s with invalid-argument", async (_label, data, message) => {
    await expectHttpsError(
      moveCampersOffWaitlist.run(request(data, ADMIN)),
      "invalid-argument",
      message
    );
    // Nothing was touched.
    expect(mockState.db.read(REGISTRATIONS, "camper1")?.status).toBe("Waitlist");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("checks the caller's permission before the body", async () => {
    await expectHttpsError(moveCampersOffWaitlist.run(request({}, PARENT)), "permission-denied");
  });

  it("moves the camper off the waitlist and emails the parents for a well-formed request", async () => {
    await moveCampersOffWaitlist.run(request(payload, ADMIN));

    expect(mockState.db.read(REGISTRATIONS, "camper1")).toMatchObject({
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
    });
    expect(mockState.db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
    expect(mockState.db.read(REGISTRATIONS, "camper1")?.updatedAt).toBeDefined();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({to: [PARENT], subject: expect.stringContaining("Mei Lin")})
    );
  });
});
