/**
 * Drives the createRegistrationSession callable end to end (through onCall's
 * `run`) against the fake Firestore, with Stripe, the email senders, Slack
 * and Mailchimp mocked. The payload validation cases live in
 * callablePayloads.test.ts; these cover the decisions after validation.
 */
import {Timestamp} from "firebase-admin/firestore";
import {CampTrack, RegistrationStatus, type Registration} from "lyf-registration-schemas";

import {callableRequest, expectHttpsError} from "./callableTestUtils";
import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState: {db: FakeFirestore} = {db: new FakeFirestore()};
const mockStripe = {
  customers: {create: jest.fn()},
  coupons: {create: jest.fn()},
  checkout: {sessions: {create: jest.fn()}},
};
const mockGetFirestoreDb = jest.fn(() => mockState.db);
jest.mock("../../src/utils", () => ({
  db: {collection: (name: string) => mockState.db.collection(name)},
  getFirestoreDb: mockGetFirestoreDb,
  getStripe: () => mockStripe,
  STRIPE_APP_TAG: "v2",
  StripeWebhookEventType: {Registration: 0, PreRegistration: 1, Donation: 2},
  RegistrationType: {PreRegistration: "PreReg", Registration: "Reg"},
}));
const mockSlackCamp = jest.fn();
const mockSlackError = jest.fn();
jest.mock("../../src/slack/slackChannelWebhooks", () => ({
  sendMessageToRegistrationForCampChannel: mockSlackCamp,
  sendMessageToRegistrationErrorMessages: mockSlackError,
}));
const mockAddParentsToMailchimp = jest.fn();
jest.mock("../../src/utils/mailchimp", () => ({
  addParentsToMailchimpList: mockAddParentsToMailchimp,
}));
const mockSendWaitlistEmail = jest.fn();
jest.mock("../../src/registrationUtils/sendWaitlistEmail", () => ({
  sendWaitlistEmail: mockSendWaitlistEmail,
}));
const mockSendRegistrationEmail = jest.fn();
jest.mock("../../src/registrationUtils/sendRegistrationEmail", () => ({
  sendRegistrationEmail: mockSendRegistrationEmail,
}));
jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());

import {
  createRegistrationSession,
  REGISTRATION_CHECKOUT_EXPIRY_MINUTES,
} from "../../src/registration/createRegistrationSession";

const PARENT = "pat@example.com";
const ADMIN = "root@example.com";
const SITE = "https://lyf-registration.tacl.org/registration";
const SUCCESS = `${SITE}?success=1`;
const CANCEL = `${SITE}?success=0`;
const FAMILY = "families/fam";
const REGISTRATIONS = "camps/2026/registrations";

// Each test speaks as this caller unless it says otherwise.
const request = (data: unknown, email: string | null = PARENT) =>
  callableRequest(data, email);

const camper = (id: string, firstName: string, grade: number) => ({
  id,
  firstName,
  lastName: "Lin",
  preferredName: null,
  birthDate: "2014-05-06",
  gender: ["Female"],
  pronouns: null,
  dietAndFoodAllergies: null,
  medicalConditions: null,
  grade,
  campTrack: grade <= 7 ? CampTrack.YOUNGER : CampTrack.OLDER,
  shirtSize: "YM",
  isReturning: false,
  cabinPreference: "",
  additionalNotes: null,
  waiverFullName: "Pat Lin",
  waiverSignature: "Pat Lin",
  waiverSignDate: "2026-03-01",
});

const demographics = {born: "US", ethnicity: ["Taiwanese"], generation: "2nd"};

function payload(overrides: Record<string, unknown> = {}) {
  const campers = (overrides.campers as unknown[]) ?? [camper("c1", "Mei", 6)];
  return {
    campYear: 2026,
    family: {city: "San Jose", state: "CA", zip: "95110", street: "1 Main St"},
    parents: [
      {email: PARENT, firstName: "Pat", lastName: "Lin", phoneNumber: "555-0100"},
    ],
    campers,
    demographics: campers.map(() => demographics),
    donation: 0,
    household: {camperMessage: "Have fun", cultureLesson: "Food"},
    joinFamilyId: null,
    successUrl: SUCCESS,
    cancelUrl: CANCEL,
    isTestData: false,
    ...overrides,
  };
}

const CAMP = {
  registrationFee: 550,
  preRegistrationFee: 100,
  siblingDiscount: 80,
  remainingSpots: {Younger: 2, Older: 1},
};

function setup(camp: Record<string, unknown> = CAMP) {
  const db = new FakeFirestore()
    .seed("camps", "2026", camp)
    // An existing family the caller created, so credits/{familyId} is predictable.
    .seed("families", "fam", {emails: [PARENT], createdBy: PARENT})
    .seed(`${FAMILY}/parents`, PARENT, {email: PARENT, firstName: "Pat", lastName: "Lin"});
  mockState.db = db;
  return db;
}

beforeEach(() => {
  mockGetFirestoreDb.mockClear();
  mockStripe.customers.create.mockReset().mockResolvedValue({id: "cus_new"});
  mockStripe.coupons.create.mockReset().mockResolvedValue({id: "coupon_1"});
  mockStripe.checkout.sessions.create.mockReset().mockResolvedValue({id: "cs_new"});
  mockSlackCamp.mockReset().mockResolvedValue(undefined);
  mockSlackError.mockReset().mockResolvedValue(undefined);
  mockAddParentsToMailchimp.mockReset().mockResolvedValue(undefined);
  mockSendWaitlistEmail.mockReset().mockResolvedValue(undefined);
  mockSendRegistrationEmail.mockReset().mockResolvedValue(undefined);
});

function expectNoStripe() {
  expect(mockStripe.customers.create).not.toHaveBeenCalled();
  expect(mockStripe.coupons.create).not.toHaveBeenCalled();
  expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
}

describe("gates", () => {
  it("rejects an anonymous caller before anything else", async () => {
    const db = setup();

    await expectHttpsError(createRegistrationSession.run(request(payload(), null)), "unauthenticated");

    expect(db.all(REGISTRATIONS)).toEqual([]);
    expectNoStripe();
  });

  it("refuses a camp year with no registration fee rather than registering for free", async () => {
    const db = setup({...CAMP, registrationFee: 0});

    await expectHttpsError(
      createRegistrationSession.run(request(payload())),
      "failed-precondition",
      /pricing is not configured/
    );

    expect(db.all(REGISTRATIONS)).toEqual([]);
  });

  it("refuses a registration after the close date and writes nothing", async () => {
    const db = setup({
      ...CAMP,
      registrationCloseDate: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
    });

    await expectHttpsError(
      createRegistrationSession.run(request(payload())),
      "failed-precondition",
      /closed on/
    );

    expect(db.all(REGISTRATIONS)).toEqual([]);
    expect(db.read(`${FAMILY}/campers`, "c1")).toBeUndefined();
    expectNoStripe();
  });

  it("lets a caller on the year's private bypass list register after the close date", async () => {
    const db = setup({
      ...CAMP,
      registrationCloseDate: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
    }).seed("camps/2026/private/bypass/emails", PARENT, {email: PARENT});

    const result = await createRegistrationSession.run(request(payload()));

    expect(result).toEqual({status: "success", code: 200, sessionId: "cs_new", isWaitlist: false});
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
  });

  it("forces production data for a non-admin asking for test data", async () => {
    setup();

    await createRegistrationSession.run(request(payload({isTestData: true})));

    expect(mockGetFirestoreDb).toHaveBeenCalledWith(true);
  });

  it("honours isTestData for an admin who may create test data", async () => {
    setup().seed("admins", ADMIN, {role: "full_admin"});

    await createRegistrationSession.run(
      request(payload({parents: [{email: ADMIN, firstName: "Root", lastName: "Admin", phoneNumber: "555-0000"}], isTestData: true}), ADMIN)
    );

    expect(mockGetFirestoreDb).toHaveBeenCalledWith(false);
  });
});

describe("waitlist", () => {
  it("waitlists a camper whose track is full: no Stripe session, a Slack notice and a waitlist email", async () => {
    const db = setup({...CAMP, remainingSpots: {Younger: 0, Older: 1}});

    const result = await createRegistrationSession.run(request(payload()));

    expect(result).toEqual({status: "success", code: 200, sessionId: null, isWaitlist: true});
    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.WAITLIST,
      spotReserved: false,
    });
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 0, Older: 1});
    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2026 Waitlist: Mei Lin", false);
    expect(mockSendWaitlistEmail).toHaveBeenCalledWith(db, PARENT, 2026, CampTrack.YOUNGER, "Mei Lin");
    expectNoStripe();
  });

  it("honours forceWaitlist for an admin even when there is room", async () => {
    const db = setup().seed("admins", ADMIN, {role: "full_admin"});

    const result = await createRegistrationSession.run(
      request(
        payload({
          parents: [{email: ADMIN, firstName: "Root", lastName: "Admin", phoneNumber: "555-0000"}],
          forceWaitlist: true,
        }),
        ADMIN
      )
    );

    expect(result).toMatchObject({sessionId: null, isWaitlist: true});
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.WAITLIST);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 1});
  });

  it("ignores forceWaitlist from a parent and registers the camper normally", async () => {
    const db = setup();

    const result = await createRegistrationSession.run(request(payload({forceWaitlist: true})));

    expect(result).toMatchObject({sessionId: "cs_new", isWaitlist: false});
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
  });

  it("creates a donation-only session when every camper is waitlisted and a donation was given", async () => {
    setup({...CAMP, remainingSpots: {Younger: 0, Older: 0}});

    const result = await createRegistrationSession.run(request(payload({donation: 25})));

    expect(result).toEqual({status: "success", code: 200, sessionId: "cs_new", isWaitlist: true});
    expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items).toEqual([
      expect.objectContaining({
        price_data: expect.objectContaining({
          product_data: {name: "$25 Donation", metadata: undefined},
          unit_amount: 2500,
        }),
      }),
    ]);
    expect(params.metadata).toEqual({eventType: 2, app: "v2"});
    expect(params.success_url).toBe(`${SUCCESS}&waitlist=1`);
    expect(params.cancel_url).toBe(CANCEL);
    expect(params).not.toHaveProperty("expires_at");
  });
});

describe("camp credit covering the whole cost", () => {
  it("activates the registration without Stripe, reserves the spot once and debits the credit", async () => {
    const db = setup().seed("credits", "fam", {amountRemaining: 1000, notes: []});

    const result = await createRegistrationSession.run(request(payload()));

    expect(result).toEqual({status: "success", code: 200, sessionId: null, isWaitlist: false});
    expectNoStripe();
    const registration = db.read(REGISTRATIONS, "c1") as Registration;
    expect(registration.status).toBe(RegistrationStatus.ACTIVE);
    expect(registration.spotReserved).toBe(true);
    // Reserved in the registration transaction; completeRegistration must not count it again.
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 1});
    expect(db.read("credits", "fam")).toEqual({
      amountRemaining: 450,
      notes: ["-550: 2026 LYF Camp Registration"],
    });
    expect(mockSendRegistrationEmail).toHaveBeenCalledWith(
      db,
      PARENT,
      2026,
      expect.objectContaining({firstName: "Mei"}),
      expect.objectContaining({status: RegistrationStatus.ACTIVE}),
      expect.anything()
    );
    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2026 Registration: Mei Lin", false);
    expect(mockAddParentsToMailchimp).toHaveBeenCalledTimes(1);
  });

  it("still sends the family to Stripe for the donation when the registration itself is covered", async () => {
    setup().seed("credits", "fam", {amountRemaining: 1000});

    const result = await createRegistrationSession.run(request(payload({donation: 40})));

    expect(result).toEqual({status: "success", code: 200, sessionId: "cs_new", isWaitlist: false});
    const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.product_data.name).toBe("$40 Donation");
    expect(params.metadata.eventType).toBe(2);
    expect(params.success_url).toBe(SUCCESS);
  });
});

describe("the Stripe checkout session", () => {
  function twoCampers() {
    return setup()
      .seed("credits", "fam", {amountRemaining: 50})
      // Kai pre-registered last year: already past the hold stage.
      .seed(REGISTRATIONS, "c2", {
        isPreRegistered: true,
        status: RegistrationStatus.PARTIAL_PAYMENT,
        amountPaid: 100,
        camperName: "Kai Lin",
        campTrack: CampTrack.OLDER,
      });
  }
  const twoCamperPayload = () =>
    payload({campers: [camper("c1", "Mei", 6), camper("c2", "Kai", 9)], donation: 25});

  it("builds the line items from the server-side price, pre-registration fee and metadata", async () => {
    twoCampers();

    const result = await createRegistrationSession.run(request(twoCamperPayload()));

    expect(result).toEqual({status: "success", code: 200, sessionId: "cs_new", isWaitlist: false});
    const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items).toHaveLength(3);
    expect(params.line_items).toEqual(
      expect.arrayContaining([
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "LYF Camp 2026 Registration: Mei Lin",
              metadata: {
                familyRef: FAMILY,
                registrationRef: `${REGISTRATIONS}/c1`,
                campYear: "2026",
                campTrack: "Younger",
              },
            },
            unit_amount: 55000,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "LYF Camp 2026 Registration for Pre-Registered Camper: Kai Lin",
              metadata: {
                familyRef: FAMILY,
                registrationRef: `${REGISTRATIONS}/c2`,
                campYear: "2026",
                campTrack: "Older",
              },
            },
            unit_amount: 45000,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: {name: "Donation", metadata: undefined},
            unit_amount: 2500,
          },
          quantity: 1,
        },
      ])
    );
  });

  it("applies the sibling discount and camp credit as one coupon named after both", async () => {
    twoCampers();

    await createRegistrationSession.run(request(twoCamperPayload()));

    expect(mockStripe.coupons.create).toHaveBeenCalledWith({
      amount_off: 13000,
      currency: "usd",
      name: "$80 Sibling Discount + $50 Camp Credit",
      duration: "once",
    });
    expect(mockStripe.checkout.sessions.create.mock.calls[0][0].discounts).toEqual([{coupon: "coupon_1"}]);
  });

  it("tags the session for this app and the Registration webhook, with a short expiry and the redirect URLs as given", async () => {
    twoCampers();
    const before = Math.floor(Date.now() / 1000);

    await createRegistrationSession.run(request(twoCamperPayload()));

    const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.metadata).toEqual({eventType: 0, app: "v2"});
    expect(params.mode).toBe("payment");
    expect(params.success_url).toBe(SUCCESS);
    expect(params.cancel_url).toBe(CANCEL);
    expect(params.payment_intent_data).toEqual({
      description: "TACL-LYF Camp 2026 Registration for Mei Lin, Kai Lin + Donation",
    });
    expect(params.expires_at).toBeGreaterThanOrEqual(before + REGISTRATION_CHECKOUT_EXPIRY_MINUTES * 60);
    expect(params.expires_at).toBeLessThanOrEqual(before + REGISTRATION_CHECKOUT_EXPIRY_MINUTES * 60 + 5);
  });

  it("creates a Stripe customer for the signed-in parent and stores it on the parent document", async () => {
    const db = twoCampers();

    await createRegistrationSession.run(request(twoCamperPayload()));

    expect(mockStripe.customers.create).toHaveBeenCalledWith({name: "Pat Lin", email: PARENT});
    expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_new");
    expect(db.read(`${FAMILY}/parents`, PARENT)?.stripeCustomerId).toBe("cus_new");
  });

  it("reuses an existing Stripe customer id", async () => {
    const db = setup();
    db.seed(`${FAMILY}/parents`, PARENT, {email: PARENT, firstName: "Pat", lastName: "Lin", stripeCustomerId: "cus_old"});

    await createRegistrationSession.run(request(payload()));

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_old");
  });

  it("holds a spot only for the newly admitted camper, not the pre-registered one", async () => {
    const db = twoCampers();

    await createRegistrationSession.run(request(twoCamperPayload()));

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 1});
    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
    });
    expect(db.read(REGISTRATIONS, "c2")).toMatchObject({status: RegistrationStatus.PARTIAL_PAYMENT});
  });

  it("charges only the admitted sibling when the other is waitlisted, and flags the redirect", async () => {
    const db = setup({...CAMP, remainingSpots: {Younger: 2, Older: 0}});

    const result = await createRegistrationSession.run(
      request(payload({campers: [camper("c1", "Mei", 6), camper("c2", "Kai", 9)]}))
    );

    expect(result).toEqual({status: "success", code: 200, sessionId: "cs_new", isWaitlist: true});
    const params = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.product_data.name).toBe("LYF Camp 2026 Registration: Mei Lin");
    // One paid camper: no sibling discount, so no coupon.
    expect(mockStripe.coupons.create).not.toHaveBeenCalled();
    expect(params.discounts).toEqual([]);
    expect(params.success_url).toBe(`${SUCCESS}&waitlist=1`);
    expect(params.payment_intent_data.description).toBe("TACL-LYF Camp 2026 Registration for Mei Lin");
    expect(db.read(REGISTRATIONS, "c2")?.status).toBe(RegistrationStatus.WAITLIST);
    expect(mockSendWaitlistEmail).toHaveBeenCalledWith(db, PARENT, 2026, CampTrack.OLDER, "Kai Lin");
  });
});

describe("Stripe failures", () => {
  it("answers 402 and reports when the checkout session cannot be created, leaving the hold in place", async () => {
    const db = setup();
    mockStripe.checkout.sessions.create.mockRejectedValue(new Error("Stripe down"));

    const result = await createRegistrationSession.run(request(payload()));

    expect(result).toEqual({
      status: "error",
      code: 402,
      message: "Failed to create a Stripe Checkout session",
    });
    expect(mockSlackError).toHaveBeenCalledWith(`Failed to create a Stripe Checkout session: ${PARENT}`);
    // The spot stays reserved although no session exists to expire it; a
    // retry by the family reuses the hold (see decideAdmissions).
    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
    });
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 1});
  });

  it("answers 402 and reports when the Stripe customer cannot be created", async () => {
    setup();
    mockStripe.customers.create.mockRejectedValue(new Error("Stripe down"));

    const result = await createRegistrationSession.run(request(payload()));

    expect(result).toEqual({
      status: "error",
      code: 402,
      message: "Failed to create the Stripe Customer",
    });
    expect(mockSlackError).toHaveBeenCalledWith(`Failed to create Stripe Customer: ${PARENT}`);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
