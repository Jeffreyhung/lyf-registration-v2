/**
 * The issueStripeRefund admin callable, driven through onCall's `run` with
 * the admin roster in the fake Firestore and Stripe mocked per environment.
 */

import {callableRequest, expectHttpsError} from "./callableTestUtils";
import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState: {db: FakeFirestore} = {db: new FakeFirestore()};
const mockStripeClient = () => ({
  checkout: {sessions: {retrieve: jest.fn()}},
  refunds: {create: jest.fn()},
});
const mockProdStripe = mockStripeClient();
const mockTestStripe = mockStripeClient();
jest.mock("../../src/utils", () => ({
  db: {collection: (name: string) => mockState.db.collection(name)},
  getStripe: (isProd: boolean) => (isProd ? mockProdStripe : mockTestStripe),
}));
const mockSlackError = jest.fn();
jest.mock("../../src/slack/slackChannelWebhooks", () => ({
  sendMessageToRegistrationErrorMessages: mockSlackError,
}));
jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());

import {issueStripeRefund} from "../../src/stripe/issueStripeRefund";

const ADMIN = "root@example.com";
const STAFF = "staff@example.com";

// Each test speaks as this caller unless it says otherwise.
const request = (data: unknown, email: string | null = ADMIN) =>
  callableRequest(data, email);

const refund = (overrides: Record<string, unknown> = {}) => ({
  stripeId: "pi_123",
  amount: 1234,
  isTestData: false,
  ...overrides,
});

beforeEach(() => {
  mockState.db = new FakeFirestore()
    .seed("admins", ADMIN, {role: "full_admin"})
    .seed("admins", STAFF, {role: "program_admin"});
  for (const stripe of [mockProdStripe, mockTestStripe]) {
    stripe.refunds.create.mockReset().mockResolvedValue({id: "re_1"});
    stripe.checkout.sessions.retrieve.mockReset().mockResolvedValue({payment_intent: "pi_from_cs"});
  }
  mockSlackError.mockReset().mockResolvedValue(undefined);
});

function expectNoRefund() {
  expect(mockProdStripe.refunds.create).not.toHaveBeenCalled();
  expect(mockTestStripe.refunds.create).not.toHaveBeenCalled();
}

describe("access", () => {
  it("rejects an anonymous caller", async () => {
    await expectHttpsError(issueStripeRefund.run(request(refund(), null)), "unauthenticated");
    expectNoRefund();
  });

  it("rejects a signed-in parent who is not an admin", async () => {
    await expectHttpsError(issueStripeRefund.run(request(refund(), "pat@example.com")), "permission-denied");
    expectNoRefund();
  });

  it("rejects an admin whose role lacks managePayments", async () => {
    await expectHttpsError(
      issueStripeRefund.run(request(refund(), STAFF)),
      "permission-denied",
      /requires one of: full_admin/
    );
    expectNoRefund();
  });
});

describe("input", () => {
  it.each([
    ["zero", 0],
    ["negative", -100],
    ["fractional cents", 12.5],
    ["more than $100,000", 100_000_01],
    ["a string", "1234"],
    ["missing", undefined],
  ])("rejects an amount that is %s", async (_label, amount) => {
    await expectHttpsError(
      issueStripeRefund.run(request(refund({amount}))),
      "invalid-argument",
      /amount must be a positive integer/
    );
    expectNoRefund();
  });

  it.each([
    ["a charge id", "ch_123"],
    ["a refund id", "re_123"],
    ["not a string", 42],
    ["missing", undefined],
  ])("rejects a stripeId that is %s", async (_label, stripeId) => {
    await expectHttpsError(
      issueStripeRefund.run(request(refund({stripeId}))),
      "invalid-argument",
      /must start with 'pi_' or 'cs_'/
    );
    expectNoRefund();
  });
});

describe("refunding", () => {
  it("refunds a payment intent directly and reports the formatted amount", async () => {
    const result = await issueStripeRefund.run(request(refund({stripeId: "pi_123", amount: 1234})));

    expect(mockProdStripe.refunds.create).toHaveBeenCalledWith({amount: 1234, payment_intent: "pi_123"});
    expect(mockProdStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual({status: "success", code: 200, message: "created refund (re_1) of $12.34"});
  });

  it("resolves a checkout session to its payment intent id first", async () => {
    await issueStripeRefund.run(request(refund({stripeId: "cs_abc", amount: 50000})));

    expect(mockProdStripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_abc");
    expect(mockProdStripe.refunds.create).toHaveBeenCalledWith({amount: 50000, payment_intent: "pi_from_cs"});
  });

  it("handles a checkout session whose payment intent is expanded", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue({payment_intent: {id: "pi_expanded"}});

    await issueStripeRefund.run(request(refund({stripeId: "cs_abc"})));

    expect(mockProdStripe.refunds.create).toHaveBeenCalledWith({amount: 1234, payment_intent: "pi_expanded"});
  });

  it("uses the test Stripe account for test data", async () => {
    await issueStripeRefund.run(request(refund({isTestData: true})));

    expect(mockTestStripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(mockProdStripe.refunds.create).not.toHaveBeenCalled();
  });

  it("uses the live Stripe account otherwise", async () => {
    await issueStripeRefund.run(request(refund({isTestData: false})));

    expect(mockProdStripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(mockTestStripe.refunds.create).not.toHaveBeenCalled();
  });

  it("returns a 402 result and reports to Slack when Stripe refuses the refund", async () => {
    mockProdStripe.refunds.create.mockRejectedValue(new Error("charge_already_refunded"));

    const result = await issueStripeRefund.run(request(refund({stripeId: "pi_123"})));

    expect(result).toEqual({status: "error", code: 402, message: "failed to create refund"});
    expect(mockSlackError).toHaveBeenCalledWith("Failed to create a Stripe refund for session: pi_123");
  });

  it("returns a 402 result when the checkout session cannot be retrieved", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("No such checkout session"));

    const result = await issueStripeRefund.run(request(refund({stripeId: "cs_missing"})));

    expect(result).toMatchObject({status: "error", code: 402});
    expect(mockProdStripe.refunds.create).not.toHaveBeenCalled();
  });
});
