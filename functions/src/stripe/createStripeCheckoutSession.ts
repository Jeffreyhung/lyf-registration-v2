import Stripe from "stripe";
import {STRIPE_APP_TAG, StripeWebhookEventType, getStripe} from "../utils";

export type LineItem<T extends Stripe.Metadata> = {
  priceInDollars: number;
  name: string;
  metadata?: T;
};

// Stripe rejects expires_at outside [30 minutes, 24 hours] from creation.
export const MIN_CHECKOUT_EXPIRY_MINUTES = 30;
export const MAX_CHECKOUT_EXPIRY_MINUTES = 24 * 60;

/**
 * Unix timestamp (seconds) for a checkout session's `expires_at`, clamped to
 * Stripe's allowed window, or undefined to keep Stripe's 24-hour default.
 */
export function checkoutExpiresAt(
  expiresAfterMinutes: number | undefined,
  nowInMs: number = Date.now()
): number | undefined {
  if (expiresAfterMinutes === undefined) return undefined;
  const minutes = Math.min(
    MAX_CHECKOUT_EXPIRY_MINUTES,
    Math.max(MIN_CHECKOUT_EXPIRY_MINUTES, expiresAfterMinutes)
  );
  return Math.floor(nowInMs / 1000) + minutes * 60;
}

/**
 * Create a Stripe checkout session.
 * @param items The individual line items in the order
 * @param successUrl The URL to return to if successful
 * @param cancelUrl The URL to return to if cancelled
 * @param customerId The customer ID to attach the session to
 * @param eventType The type of event this checkout is for and will subsequently trigger in the webhook
 * @param description The description of the order
 * @param isTestData Whether this request is for test data
 * @param discount Any applicable discounts
 * @param options.expiresAfterMinutes How long the session stays payable. Stripe
 *   defaults to 24 hours and allows 30 minutes to 24 hours. Registration
 *   sessions hold camp spots, so they pass a short window and release the
 *   spots on `checkout.session.expired`; donation and pre-registration
 *   sessions hold nothing and keep Stripe's default.
 * @returns
 */
export async function createStripeCheckoutSession<T extends Stripe.Metadata>(
  items: LineItem<T>[],
  successUrl: string,
  cancelUrl: string,
  customerId: string,
  eventType: StripeWebhookEventType,
  description: string,
  isTestData: boolean,
  discount?: {
    amount: number;
    name: string;
  } | null,
  options?: {expiresAfterMinutes?: number}
): Promise<Stripe.Checkout.Session> {
  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
  const stripe = getStripe(!isTestData);
  const expiresAt = checkoutExpiresAt(options?.expiresAfterMinutes);

  if (discount) {
    const coupon = await stripe.coupons.create({
      amount_off: discount.amount * 100,
      currency: "usd",
      name: discount.name,
      duration: "once",
    });
    discounts.push({
      coupon: coupon.id,
    });
  }

  return await stripe.checkout.sessions.create({
    line_items: items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          metadata: item.metadata,
        },
        unit_amount: item.priceInDollars * 100,
      },
      quantity: 1,
    })),
    mode: "payment",
    metadata: {
      eventType: eventType,
      // Lets the v2 webhook ignore sessions created by v1, which shares this
      // Stripe account and delivers every event to both endpoints.
      app: STRIPE_APP_TAG,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer: customerId,
    // payment_method_types: ["us_bank_account", "card"],
    payment_intent_data: {
      description: description,
    },
    discounts: discounts,
    ...(expiresAt ? {expires_at: expiresAt} : {}),
  });
}
