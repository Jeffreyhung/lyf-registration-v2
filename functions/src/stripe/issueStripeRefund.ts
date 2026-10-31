import * as Sentry from "@sentry/node";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";

// Utils
import {getStripe} from "../utils";
import {sendMessageToRegistrationErrorMessages} from "../slack/slackChannelWebhooks";
import {
  assertAdmin,
  adminCallableOptions,
  validateDollarAmount,
} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";

type IssueStripeRefundRequest = {
  stripeId: string;
  amount: number;
  isTestData: boolean;
};

/**
 * Issues a full refund for the charge from a given Stripe checkout session.
 * @param stripeId The Stripe ID associated with the charge being refunded
 * @param amount A positive integer in representing how much of this charge to refund (in cents)
 * @param isTestData Whether this request is for test data
 * @returns Code 200 if successful, 402 if any error occurs
 */
export const issueStripeRefund = onCall<IssueStripeRefundRequest>(
  adminCallableOptions,
  withSentryCallable("issueStripeRefund", async (request) => {
    await assertAdmin(request, "managePayments");

    // Not routed through a schemas validator (no document is written), so the
    // three fields are checked by hand. A missing body must not become an
    // "internal" error, and the test-data switch is honoured only when it is
    // literally true.
    const data = (request.data ?? {}) as Partial<IssueStripeRefundRequest>;
    const {stripeId} = data;
    const amount = data.amount as number;
    const isTestData = data.isTestData === true;
    validateDollarAmount(amount, "amount", 100_000_00);

    if (
      typeof stripeId !== "string" ||
      (!stripeId.startsWith("pi_") && !stripeId.startsWith("cs_"))
    ) {
      throw new HttpsError(
        "invalid-argument",
        "stripeId must start with 'pi_' or 'cs_'"
      );
    }

    try {
      const stripe = getStripe(!isTestData);
      let paymentIntent = null;
      if (stripeId.startsWith("pi_")) {
        paymentIntent = stripeId;
      } else {
        const checkoutSession = await stripe.checkout.sessions.retrieve(
          stripeId
        );
        paymentIntent =
          typeof checkoutSession.payment_intent === "string"
            ? checkoutSession.payment_intent
            : checkoutSession.payment_intent!.id;
      }
      const refundResponse = await stripe.refunds.create({
        amount: amount,
        payment_intent: paymentIntent,
      });
      const formattedAmount = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount / 100.0);
      return {
        status: "success",
        code: 200,
        message: `created refund (${refundResponse.id}) of ${formattedAmount}`,
      };
    } catch (e) {
      Sentry.captureException(e);
      logger.error(e);
      sendMessageToRegistrationErrorMessages(
        `Failed to create a Stripe refund for session: ${stripeId}`
      );
      return {
        status: "error",
        code: 402,
        message: "failed to create refund",
      };
    }
  })
);
