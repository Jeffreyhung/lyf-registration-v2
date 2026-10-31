/**
 * fulfillRegistration is what the Stripe webhook calls for a paid (or
 * paying) registration checkout session. These tests run the real module
 * against the fake Firestore with the senders (email, Slack, Mailchimp)
 * mocked, and assert on the documents written and the calls made.
 */
import type Stripe from "stripe";
import {
  CampTrack,
  RegistrationStatus,
  type Payment,
  type Registration,
} from "lyf-registration-schemas";

import {FakeFirestore} from "./fakeFirestore";

// ../utils opens Firestore, Stripe and the mail transport at import time.
jest.mock("../../src/utils", () => ({
  RegistrationType: {PreRegistration: "PreReg", Registration: "Reg"},
  getStripe: () => ({}),
}));
// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
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
const mockSendRegistrationEmail = jest.fn();
jest.mock("../../src/registrationUtils/sendRegistrationEmail", () => ({
  sendRegistrationEmail: mockSendRegistrationEmail,
}));
const mockCaptureException = jest.fn();
jest.mock("@sentry/node", () => ({captureException: mockCaptureException}));

import {fulfillRegistration} from "../../src/registration/fullfillRegistration";
import {createDiscountName} from "../../src/registrationUtils";

const FAMILY = "families/fam";
const CAMPERS = `${FAMILY}/campers`;
const REGISTRATIONS = "camps/2026/registrations";
const EMAIL = "pat@example.com";

type Camper = {id: string; name: string; track: CampTrack; spotReserved?: boolean};

function setup(campers: Camper[], camp: Record<string, unknown> = {}) {
  const db = new FakeFirestore()
    .seed("camps", "2026", {remainingSpots: {Younger: 3, Older: 2}, ...camp})
    .seed("families", "fam", {emails: [EMAIL]})
    .seed(`${FAMILY}/parents`, EMAIL, {email: EMAIL, firstName: "Pat", lastName: "Lin"});
  for (const c of campers) {
    const [firstName, lastName] = c.name.split(" ");
    db.seed(CAMPERS, c.id, {firstName, lastName, birthDate: "2014-05-06", gender: ["Female"]})
      .seed(`${CAMPERS}/${c.id}/private`, "health", {dietAndFoodAllergies: "Peanuts", medicalConditions: null})
      .seed(REGISTRATIONS, c.id, {
        camperName: c.name,
        camper: db.doc(`${CAMPERS}/${c.id}`),
        campTrack: c.track,
        grade: c.track === CampTrack.YOUNGER ? 6 : 9,
        shirtSize: "YM",
        status: RegistrationStatus.PENDING_PAYMENT,
        ...(c.spotReserved === undefined ? {} : {spotReserved: c.spotReserved}),
      });
  }
  return db;
}

function registrationItem(c: Camper, amountCents = 55000) {
  return {
    description: `LYF Camp 2026 Registration: ${c.name}`,
    amount_total: amountCents,
    price: {
      product: {
        metadata: {
          familyRef: FAMILY,
          registrationRef: `${REGISTRATIONS}/${c.id}`,
          campYear: "2026",
          campTrack: c.track,
        },
      },
    },
  };
}

const donationItem = (amountCents: number) => ({
  description: "Donation",
  amount_total: amountCents,
  price: {product: {metadata: {}}},
});

function session(
  items: object[],
  overrides: Record<string, unknown> = {}
): Stripe.Checkout.Session {
  const total = items.reduce((sum, i) => sum + ((i as {amount_total: number}).amount_total ?? 0), 0);
  return {
    id: "cs_paid_1",
    payment_status: "paid",
    customer: "cus_1",
    customer_email: EMAIL,
    customer_details: {email: EMAIL, name: "Pat Lin"},
    amount_total: total,
    total_details: {amount_discount: 0},
    payment_intent: {id: "pi_1", payment_method: {type: "card"}},
    line_items: {data: items},
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

const mei: Camper = {id: "c1", name: "Mei Lin", track: CampTrack.YOUNGER, spotReserved: true};
const kai: Camper = {id: "c2", name: "Kai Lin", track: CampTrack.OLDER, spotReserved: true};

beforeEach(() => {
  mockSlackCamp.mockReset().mockResolvedValue(undefined);
  mockSlackError.mockReset().mockResolvedValue(undefined);
  mockAddParentsToMailchimp.mockReset().mockResolvedValue(undefined);
  mockSendRegistrationEmail.mockReset().mockResolvedValue(undefined);
  mockCaptureException.mockReset();
});

describe("a paid session", () => {
  it("records the payment with the expected fields", async () => {
    const db = setup([mei]);

    await fulfillRegistration(db.as(), session([registrationItem(mei), donationItem(2500)]), false);

    const payment = db.read("payments", "cs_paid_1") as Payment;
    expect(payment).toMatchObject({
      customerEmail: EMAIL,
      customerName: "Pat Lin",
      customerId: "cus_1",
      donation: 25,
      discount: null,
      items: [
        {amount: 550, description: "LYF Camp 2026 Registration: Mei Lin"},
        {amount: 25, description: "Donation"},
      ],
      paymentMethod: "card",
      status: "paid",
      stripeId: "cs_paid_1",
      type: "Stripe",
      total: 575,
    });
    expect(payment.registrations!.map((r) => r.path)).toEqual([`${REGISTRATIONS}/c1`]);
    expect(payment.createdAt).toBeDefined();
    expect(payment.updatedAt).toBeDefined();
  });

  it("flips the registration to ACTIVE and links the payment", async () => {
    const db = setup([mei]);

    await fulfillRegistration(db.as(), session([registrationItem(mei)]), false);

    const registration = db.read(REGISTRATIONS, "c1") as Registration;
    expect(registration.status).toBe(RegistrationStatus.ACTIVE);
    expect(registration.payments!.map((p) => p.path)).toEqual(["payments/cs_paid_1"]);
    expect(registration.updatedAt).toBeDefined();
  });

  it("does not decrement remainingSpots again for a registration that already holds its spot", async () => {
    const db = setup([mei, kai]);

    await fulfillRegistration(db.as(), session([registrationItem(mei), registrationItem(kai)]), false);

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 2});
  });

  it("decrements once per camper per track for registrations that do not yet hold a spot, and marks them reserved", async () => {
    const legacyMei = {...mei, spotReserved: undefined};
    const legacyKai = {...kai, spotReserved: false};
    const legacyZoe: Camper = {id: "c3", name: "Zoe Lin", track: CampTrack.OLDER, spotReserved: false};
    const db = setup([legacyMei, legacyKai, legacyZoe]);

    await fulfillRegistration(
      db.as(),
      session([registrationItem(legacyMei), registrationItem(legacyKai), registrationItem(legacyZoe)]),
      false
    );

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
    for (const id of ["c1", "c2", "c3"]) {
      expect(db.read(REGISTRATIONS, id)?.spotReserved).toBe(true);
    }
  });

  it("decrements only for the campers without a hold when the session mixes both", async () => {
    const held = mei;
    const notHeld = {...kai, spotReserved: false};
    const db = setup([held, notHeld]);

    await fulfillRegistration(db.as(), session([registrationItem(held), registrationItem(notHeld)]), false);

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 1});
  });

  it("floors a track at zero rather than going negative", async () => {
    const c: Camper = {id: "c1", name: "Mei Lin", track: CampTrack.YOUNGER, spotReserved: false};
    const db = setup([c], {remainingSpots: {Younger: 0, Older: 2}});

    await fulfillRegistration(db.as(), session([registrationItem(c)]), false);

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 0, Older: 2});
    expect(db.read(REGISTRATIONS, "c1")?.spotReserved).toBe(true);
  });

  it("sends one confirmation email per camper with the camper, registration and health documents", async () => {
    const db = setup([mei, kai]);

    await fulfillRegistration(db.as(), session([registrationItem(mei), registrationItem(kai)]), false);

    expect(mockSendRegistrationEmail).toHaveBeenCalledTimes(2);
    expect(mockSendRegistrationEmail).toHaveBeenCalledWith(
      db,
      EMAIL,
      2026,
      expect.objectContaining({firstName: "Mei", lastName: "Lin"}),
      expect.objectContaining({camperName: "Mei Lin", status: RegistrationStatus.ACTIVE}),
      {dietAndFoodAllergies: "Peanuts", medicalConditions: null}
    );
    expect(mockSendRegistrationEmail).toHaveBeenCalledWith(
      db,
      EMAIL,
      2026,
      expect.objectContaining({firstName: "Kai"}),
      expect.objectContaining({camperName: "Kai Lin"}),
      expect.anything()
    );
  });

  it("announces each registration in the camp channel, tagged with the test-data flag", async () => {
    const db = setup([mei, kai]);

    await fulfillRegistration(db.as(), session([registrationItem(mei), registrationItem(kai)]), true);

    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2026 Registration: Mei Lin", true);
    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2026 Registration: Kai Lin", true);
    expect(mockSlackError).not.toHaveBeenCalled();
  });

  it("subscribes the family's parents to the registered list with the camp year and track tags", async () => {
    const db = setup([mei, kai]);

    await fulfillRegistration(db.as(), session([registrationItem(mei), registrationItem(kai)]), false);

    expect(mockAddParentsToMailchimp).toHaveBeenCalledTimes(1);
    const [mailchimpDb, regType, parents, campYear, tracks, isTestData] =
      mockAddParentsToMailchimp.mock.calls[0];
    expect(mailchimpDb).toBe(db.as());
    expect(regType).toBe("Reg");
    expect(parents.path).toBe(`${FAMILY}/parents`);
    expect(campYear).toBe("2026");
    expect(tracks).toEqual([CampTrack.YOUNGER, CampTrack.OLDER]);
    expect(isTestData).toBe(false);
  });

  it("is safe to re-run for the same session: status, payment link and spots are unchanged", async () => {
    const db = setup([mei, {...kai, spotReserved: false}]);
    const paid = session([registrationItem(mei), registrationItem(kai)]);

    await fulfillRegistration(db.as(), paid, false);
    await fulfillRegistration(db.as(), paid, false);

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 1});
    const registration = db.read(REGISTRATIONS, "c2") as Registration;
    expect(registration.status).toBe(RegistrationStatus.ACTIVE);
    expect(registration.payments).toHaveLength(1);
    expect(db.all("payments")).toHaveLength(1);
    // Side effects are not deduplicated: the confirmation emails go out
    // again. The webhook's event-id claim is what prevents this in practice.
    expect(mockSendRegistrationEmail).toHaveBeenCalledTimes(4);
  });
});

describe("discounts", () => {
  it("attributes the coupon to sibling discount first and camp credit for the rest, and debits the credit", async () => {
    const db = setup([mei, kai], {siblingDiscount: 80})
      .seed("credits", "fam", {amountRemaining: 150, notes: ["+150: 2025 refund"]});

    await fulfillRegistration(
      db.as(),
      session([registrationItem(mei), registrationItem(kai)], {total_details: {amount_discount: 18000}}),
      false
    );

    expect((db.read("payments", "cs_paid_1") as Payment).discount).toEqual({
      amount: 180,
      name: createDiscountName(80, 100),
    });
    expect(db.read("credits", "fam")).toEqual({
      amountRemaining: 50,
      notes: ["+150: 2025 refund", "-100: 2026 LYF Camp Registration"],
    });
    expect(mockSlackCamp).toHaveBeenCalledWith("Used camp credit for pat@example.com from family fam");
  });

  it("uses the default sibling discount when the camp year does not set one", async () => {
    const db = setup([mei, kai]).seed("credits", "fam", {amountRemaining: 500});

    await fulfillRegistration(
      db.as(),
      session([registrationItem(mei), registrationItem(kai)], {total_details: {amount_discount: 8000}}),
      false
    );

    expect((db.read("payments", "cs_paid_1") as Payment).discount).toEqual({
      amount: 80,
      name: createDiscountName(80, 0),
    });
    // Nothing attributed to credit, so the credit document is untouched.
    expect(db.read("credits", "fam")).toEqual({amountRemaining: 500});
  });

  it("attributes the whole coupon to camp credit for a single camper", async () => {
    const db = setup([mei]).seed("credits", "fam", {amountRemaining: 300});

    await fulfillRegistration(
      db.as(),
      session([registrationItem(mei)], {total_details: {amount_discount: 20000}}),
      false
    );

    expect((db.read("payments", "cs_paid_1") as Payment).discount).toEqual({
      amount: 200,
      name: createDiscountName(0, 200),
    });
    expect(db.read("credits", "fam")?.amountRemaining).toBe(100);
  });

  it("records no discount and leaves credits alone when Stripe applied none", async () => {
    const db = setup([mei]).seed("credits", "fam", {amountRemaining: 300});

    await fulfillRegistration(db.as(), session([registrationItem(mei)]), false);

    expect((db.read("payments", "cs_paid_1") as Payment).discount).toBeNull();
    expect(db.read("credits", "fam")?.amountRemaining).toBe(300);
  });
});

describe("sessions that are not ready or not ours to fulfil", () => {
  it("does nothing for an unpaid session (the async_payment_succeeded event will finish it)", async () => {
    const db = setup([mei]);

    await fulfillRegistration(
      db.as(),
      session([registrationItem(mei)], {payment_status: "unpaid"}),
      false
    );

    expect(db.read("payments", "cs_paid_1")).toBeUndefined();
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
    expect(mockSendRegistrationEmail).not.toHaveBeenCalled();
    expect(mockSlackCamp).not.toHaveBeenCalled();
  });

  it("reports a session without line items and writes nothing", async () => {
    const db = setup([mei]);

    await fulfillRegistration(db.as(), session([], {line_items: null}), false);

    expect(mockSlackError).toHaveBeenCalledWith(
      expect.stringMatching(/No line items found in session cs_paid_1 from pat@example.com/)
    );
    expect(db.all("payments")).toEqual([]);
  });

  it("reports a session whose line items carry no registration metadata and writes nothing", async () => {
    const db = setup([mei]);
    const noMetadata = {
      description: "LYF Camp 2026 Registration: Mei Lin",
      amount_total: 55000,
      price: {product: {}},
    };

    await fulfillRegistration(db.as(), session([noMetadata]), false);

    expect(mockSlackError).toHaveBeenCalledWith(expect.stringMatching(/Couldn't find camp year/));
    expect(db.all("payments")).toEqual([]);
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
  });
});

describe("partial failures", () => {
  it("keeps going when one confirmation email fails: the other is sent, the failure is reported, and the data is still written", async () => {
    const db = setup([mei, kai]);
    mockSendRegistrationEmail.mockImplementation(async (_db, _email, _year, camper) => {
      if (camper.firstName === "Mei") throw new Error("SMTP down");
    });

    await fulfillRegistration(db.as(), session([registrationItem(mei), registrationItem(kai)]), false);

    expect(mockSendRegistrationEmail).toHaveBeenCalledTimes(2);
    expect(mockSlackError).toHaveBeenCalledWith(
      "Failed to send confirmation email to pat@example.com for Mei Lin"
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.ACTIVE);
    expect(db.read(REGISTRATIONS, "c2")?.status).toBe(RegistrationStatus.ACTIVE);
    expect(db.read("payments", "cs_paid_1")).toBeDefined();
    expect(mockAddParentsToMailchimp).toHaveBeenCalledTimes(1);
  });

  it("reports a registration whose camper document is missing instead of emailing", async () => {
    const db = setup([mei]);
    db.remove(CAMPERS, "c1");

    await fulfillRegistration(db.as(), session([registrationItem(mei)]), false);

    expect(mockSendRegistrationEmail).not.toHaveBeenCalled();
    expect(mockSlackError).toHaveBeenCalledWith(
      "Failed to send confirmation email to pat@example.com for Mei Lin"
    );
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.ACTIVE);
  });

  it("surfaces a failure after the emails went out (so the webhook retries, re-sending them)", async () => {
    const db = setup([mei]);
    mockAddParentsToMailchimp.mockRejectedValue(new Error("Mailchimp 500"));

    await expect(
      fulfillRegistration(db.as(), session([registrationItem(mei)]), false)
    ).rejects.toThrow("Mailchimp 500");

    // Already done before the failure: payment, status and the email.
    expect(db.read("payments", "cs_paid_1")).toBeDefined();
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.ACTIVE);
    expect(mockSendRegistrationEmail).toHaveBeenCalledTimes(1);
  });
});
