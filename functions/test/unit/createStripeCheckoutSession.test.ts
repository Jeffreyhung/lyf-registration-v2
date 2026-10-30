// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockSessionsCreate = jest.fn();
const mockCouponsCreate = jest.fn();
jest.mock("../../src/utils", () => ({
  STRIPE_APP_TAG: "v2",
  StripeWebhookEventType: {Registration: 0, PreRegistration: 1, Donation: 2},
  getStripe: () => ({
    checkout: {sessions: {create: mockSessionsCreate}},
    coupons: {create: mockCouponsCreate},
  }),
}));

import {StripeWebhookEventType} from "../../src/utils";
import {
  checkoutExpiresAt,
  createStripeCheckoutSession,
  MAX_CHECKOUT_EXPIRY_MINUTES,
  MIN_CHECKOUT_EXPIRY_MINUTES,
} from "../../src/stripe/createStripeCheckoutSession";

const NOW = 1_700_000_000_000;

describe("checkoutExpiresAt", () => {
  it("keeps Stripe's default when no expiry is requested", () => {
    expect(checkoutExpiresAt(undefined, NOW)).toBeUndefined();
  });

  it("returns a unix timestamp in seconds the requested number of minutes out", () => {
    expect(checkoutExpiresAt(45, NOW)).toBe(NOW / 1000 + 45 * 60);
  });

  it("clamps to Stripe's 30 minute minimum", () => {
    expect(checkoutExpiresAt(5, NOW)).toBe(
      NOW / 1000 + MIN_CHECKOUT_EXPIRY_MINUTES * 60
    );
  });

  it("clamps to Stripe's 24 hour maximum", () => {
    expect(checkoutExpiresAt(10_000, NOW)).toBe(
      NOW / 1000 + MAX_CHECKOUT_EXPIRY_MINUTES * 60
    );
  });

  it("truncates to whole seconds", () => {
    expect(Number.isInteger(checkoutExpiresAt(30, NOW + 999))).toBe(true);
  });
});

describe("createStripeCheckoutSession", () => {
  beforeEach(() => {
    mockSessionsCreate.mockReset().mockResolvedValue({id: "cs_123"});
    mockCouponsCreate.mockReset().mockResolvedValue({id: "coupon_1"});
  });

  const items = [{priceInDollars: 10, name: "Thing"}];

  it("omits expires_at by default so donation / pre-registration sessions are unchanged", async () => {
    await createStripeCheckoutSession(
      items,
      "https://example.com/ok",
      "https://example.com/cancel",
      "cus_1",
      StripeWebhookEventType.Donation,
      "desc",
      false
    );

    const params = mockSessionsCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty("expires_at");
    expect(params.metadata).toEqual({eventType: StripeWebhookEventType.Donation, app: "v2"});
  });

  it("sets expires_at when an expiry is requested", async () => {
    const before = Math.floor(Date.now() / 1000);
    await createStripeCheckoutSession(
      items,
      "https://example.com/ok",
      "https://example.com/cancel",
      "cus_1",
      StripeWebhookEventType.Registration,
      "desc",
      false,
      null,
      {expiresAfterMinutes: 45}
    );

    const {expires_at: expiresAt} = mockSessionsCreate.mock.calls[0][0];
    expect(expiresAt).toBeGreaterThanOrEqual(before + 45 * 60);
    expect(expiresAt).toBeLessThanOrEqual(before + 45 * 60 + 5);
  });

  it("still creates a coupon for discounts", async () => {
    await createStripeCheckoutSession(
      items,
      "https://example.com/ok",
      "https://example.com/cancel",
      "cus_1",
      StripeWebhookEventType.Registration,
      "desc",
      false,
      {amount: 25, name: "Sibling Discount"},
      {expiresAfterMinutes: 45}
    );

    expect(mockCouponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({amount_off: 2500, name: "Sibling Discount"})
    );
    expect(mockSessionsCreate.mock.calls[0][0].discounts).toEqual([{coupon: "coupon_1"}]);
  });
});
