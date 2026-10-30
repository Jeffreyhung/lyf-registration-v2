/**
 * fulfillPreRegistrations is what the Stripe webhook calls for a paid
 * pre-registration checkout session. Real module, fake Firestore, mocked
 * Slack and Mailchimp.
 */
import type Stripe from "stripe";
import {
  MAX_GRADE,
  RegistrationStatus,
  type Payment,
  type Registration,
} from "lyf-registration-schemas";

import {FakeFirestore} from "./fakeFirestore";

// ../utils opens Firestore, Stripe and the mail transport at import time.
jest.mock("../../src/utils", () => ({
  RegistrationType: {PreRegistration: "PreReg", Registration: "Reg"},
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

import {fulfillPreRegistrations} from "../../src/preRegistration/fulfillPreRegistrations";

const FAMILY = "families/fam";
const CAMPERS = `${FAMILY}/campers`;
const REGISTRATIONS = "camps/2027/registrations";
const EMAIL = "pat@example.com";

function setup() {
  return new FakeFirestore()
    .seed("families", "fam", {emails: ["Pat@Example.com", " co@example.com "]})
    .seed(CAMPERS, "c1", {firstName: "Mei", lastName: "Lin", registrations: []})
    .seed(CAMPERS, "c2", {firstName: "Kai", lastName: "Lin"});
}

function preRegItem(camperId: string, camperName: string, grade: string, amountCents = 50000) {
  return {
    description: `LYF Camp 2027 Pre-Registration: ${camperName}`,
    amount_total: amountCents,
    amount_subtotal: amountCents,
    price: {
      product: {
        metadata: {
          campYear: "2027",
          camperName,
          camperRefString: `${CAMPERS}/${camperId}`,
          currentGradeString: grade,
        },
      },
    },
  };
}

const donationItem = (amountCents: number) => ({
  description: "Donation",
  amount_total: amountCents,
  amount_subtotal: amountCents,
  price: {product: {metadata: {}}},
});

function session(items: object[], overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  const total = items.reduce((sum, i) => sum + (i as {amount_total: number}).amount_total, 0);
  return {
    id: "cs_pre_1",
    payment_status: "paid",
    customer: "cus_1",
    customer_email: EMAIL,
    customer_details: {email: EMAIL, name: "Pat Lin"},
    amount_total: total,
    payment_intent: {id: "pi_pre_1", payment_method: {type: "us_bank_account"}},
    line_items: {data: items},
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

beforeEach(() => {
  mockSlackCamp.mockReset().mockResolvedValue(undefined);
  mockSlackError.mockReset().mockResolvedValue(undefined);
  mockAddParentsToMailchimp.mockReset().mockResolvedValue(undefined);
});

describe("a paid pre-registration", () => {
  it("records the payment under the payment intent id, without the donation in its items", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", "6"), donationItem(2500)]), false);

    const payment = db.read("payments", "pi_pre_1") as Payment;
    expect(payment).toMatchObject({
      customerEmail: EMAIL,
      customerName: "Pat Lin",
      customerId: "cus_1",
      donation: 25,
      items: [{amount: 500, description: "LYF Camp 2027 Pre-Registration: Mei Lin"}],
      stripeId: "pi_pre_1",
      total: 525,
      type: "Stripe",
      paymentMethod: "us_bank_account",
      status: "paid",
    });
    expect(payment.createdAt).toBeDefined();
  });

  it("creates next year's registration keyed by the camper id as a partial payment", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", "6")]), false);

    const registration = db.read(REGISTRATIONS, "c1") as Registration;
    expect(registration).toMatchObject({
      status: RegistrationStatus.PARTIAL_PAYMENT,
      amountPaid: 500,
      grade: 7,
      isPreRegistered: true,
      camperName: "Mei Lin",
      familyEmails: ["pat@example.com", "co@example.com"],
    });
    expect(registration.camper!.path).toBe(`${CAMPERS}/c1`);
    expect(registration.payments!.map((p) => p.path)).toEqual(["payments/pi_pre_1"]);
    expect(registration.createdAt).toBeDefined();
    expect(registration.updatedAt).toBeDefined();
  });

  it("links the registration back onto the camper", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", "6")]), false);

    const camper = db.read(CAMPERS, "c1") as {registrations: {path: string}[]};
    expect(camper.registrations.map((r) => r.path)).toEqual([`${REGISTRATIONS}/c1`]);
  });

  it("announces each camper in the camp channel and subscribes the parents once", async () => {
    const db = setup();

    await fulfillPreRegistrations(
      db.as(),
      session([preRegItem("c1", "Mei Lin", "6"), preRegItem("c2", "Kai Lin", "9")]),
      true
    );

    expect(mockSlackCamp).toHaveBeenCalledTimes(2);
    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2027 Pre-Registration: Mei Lin", true);
    expect(mockSlackCamp).toHaveBeenCalledWith("LYF Camp 2027 Pre-Registration: Kai Lin", true);
    expect(mockAddParentsToMailchimp).toHaveBeenCalledTimes(1);
    const [regType, parents, campYear] = mockAddParentsToMailchimp.mock.calls[0];
    expect(regType).toBe("PreReg");
    expect(parents.path).toBe(`${FAMILY}/parents`);
    expect(campYear).toBe("2027");
    expect(db.read(REGISTRATIONS, "c2")).toMatchObject({grade: 10, amountPaid: 500});
  });

  it("merges into an existing registration for that camper and adds to amountPaid", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      amountPaid: 100,
      internalNotes: "keep me",
      payments: [],
    });

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", "6")]), false);

    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      amountPaid: 600,
      internalNotes: "keep me",
      status: RegistrationStatus.PARTIAL_PAYMENT,
    });
  });

  it("takes the customer id from an expanded customer object and falls back to empty", async () => {
    const expanded = setup();
    await fulfillPreRegistrations(
      expanded.as(),
      session([preRegItem("c1", "Mei Lin", "6")], {customer: {id: "cus_obj"}}),
      false
    );
    expect(expanded.read("payments", "pi_pre_1")?.customerId).toBe("cus_obj");

    const none = setup();
    await fulfillPreRegistrations(
      none.as(),
      session([preRegItem("c1", "Mei Lin", "6")], {customer: null}),
      false
    );
    expect(none.read("payments", "pi_pre_1")?.customerId).toBe("");
  });
});

describe("grades", () => {
  it("writes no grade when the current grade is unknown", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", "")]), false);

    expect(db.read(REGISTRATIONS, "c1")).not.toHaveProperty("grade");
  });

  it("writes no grade when next year's grade would be past the last supported grade", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([preRegItem("c1", "Mei Lin", String(MAX_GRADE))]), false);

    expect(db.read(REGISTRATIONS, "c1")).not.toHaveProperty("grade");
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PARTIAL_PAYMENT);
  });
});

describe("a session that is not paid yet", () => {
  it("creates the registration as pending payment with nothing paid and announces the pending payment", async () => {
    const db = setup();

    await fulfillPreRegistrations(
      db.as(),
      session([preRegItem("c1", "Mei Lin", "6")], {payment_status: "unpaid"}),
      false
    );

    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.PENDING_PAYMENT,
      amountPaid: 0,
      isPreRegistered: true,
    });
    expect(db.read("payments", "pi_pre_1")?.status).toBe("unpaid");
    expect(mockSlackCamp).toHaveBeenCalledWith("Processing payment from: pat@example.com", false);
  });

  it("then upgrades to partial payment when the paid event for the same session arrives", async () => {
    const db = setup();
    const items = [preRegItem("c1", "Mei Lin", "6")];

    await fulfillPreRegistrations(db.as(), session(items, {payment_status: "unpaid"}), false);
    await fulfillPreRegistrations(db.as(), session(items), false);

    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.PARTIAL_PAYMENT,
      amountPaid: 500,
    });
    expect((db.read(REGISTRATIONS, "c1") as Registration).payments).toHaveLength(1);
    expect(db.read("payments", "pi_pre_1")?.status).toBe("paid");
  });
});

describe("bad input", () => {
  it("reports a session without line items and writes nothing", async () => {
    const db = setup();

    await fulfillPreRegistrations(db.as(), session([], {line_items: null}), false);

    expect(mockSlackError).toHaveBeenCalledWith(expect.stringMatching(/No line items found on session cs_pre_1/));
    expect(db.all("payments")).toEqual([]);
    expect(db.all(REGISTRATIONS)).toEqual([]);
  });

  it("skips a line item without metadata, reports it, and still handles the others", async () => {
    const db = setup();
    const noMetadata = {
      description: "LYF Camp 2027 Pre-Registration: Nobody",
      amount_total: 50000,
      amount_subtotal: 50000,
      price: {product: {}},
    };

    await fulfillPreRegistrations(db.as(), session([noMetadata, preRegItem("c2", "Kai Lin", "9")]), false);

    expect(mockSlackError).toHaveBeenCalledWith(
      expect.stringMatching(/No metadata found on line item with index 0/)
    );
    expect(db.read(REGISTRATIONS, "c2")).toBeDefined();
    expect(db.all(REGISTRATIONS)).toHaveLength(1);
    // The payment still records every non-donation item.
    expect((db.read("payments", "pi_pre_1") as Payment).items).toHaveLength(2);
  });

  it("skips a line item with an empty camp year and reports it", async () => {
    const db = setup();
    const item = preRegItem("c1", "Mei Lin", "6");
    item.price.product.metadata.campYear = "";

    await fulfillPreRegistrations(db.as(), session([item]), false);

    expect(mockSlackError).toHaveBeenCalledWith(expect.stringMatching(/Couldn't find camp year/));
    expect(db.all("camps//registrations")).toEqual([]);
    expect(db.all(REGISTRATIONS)).toEqual([]);
  });
});
