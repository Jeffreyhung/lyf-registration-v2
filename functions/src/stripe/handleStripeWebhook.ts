import * as Sentry from "@sentry/node";
import Stripe from "stripe";
import {logger} from "firebase-functions";
import {onRequest, Request} from "firebase-functions/v2/https";
import {Response} from "express";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

// gRPC status code returned by DocumentReference.create() when the doc exists
const GRPC_ALREADY_EXISTS = 6;
// Stripe retries webhooks for up to 3 days; keep claims well past that.
const PROCESSED_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

import {
  stripeEndpointSecret,
  testStripeEndpointSecret,
  STRIPE_APP_TAG,
  StripeWebhookEventType,
  getFirestoreDb,
  getStripe,
} from "../utils";
import {fulfillRegistration} from "../registration/fullfillRegistration";
import {releaseRegistrationHolds} from "../registration/releaseRegistrationHolds";
import {fulfillPreRegistrations} from "../preRegistration/fulfillPreRegistrations";
import {
  sendMessageToRegistrationErrorMessages,
  sendMessageToRegistrationForCampChannel,
} from "../slack/slackChannelWebhooks";
import {withSentryRequest} from "../utils/sentry";

/**
 * A wrapper around the anonymous function handler used in onRequest. This wrapper
 * provides the database object as needed.
 * @param isProd Whether the request is coming from the production or test webhook
 * @returns The actual onRequest handler used by the webhook.
 */
function handleStripeWebhookHelper(
  isProd: boolean
): (request: Request, response: Response) => Promise<void> {
  const db = getFirestoreDb(isProd);
  const stripe = getStripe(isProd);

  return async (request, response) => {
    const sig = request.headers["stripe-signature"] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        sig,
        isProd ? stripeEndpointSecret : testStripeEndpointSecret
      );
    } catch (err) {
      Sentry.captureException(err);
      logger.error("Invalid Stripe event", err);
      response.status(400).send();
      return;
    }

    // Idempotency: atomically claim the event ID before doing any work.
    // create() fails if the doc exists, so two concurrent deliveries of the
    // same event (Stripe retries aggressively) can't both get past this line
    // the way a get-then-set check could.
    const eventRef = db.collection("_processedEvents").doc(event.id);
    try {
      await eventRef.create({
        type: event.type,
        receivedAt: FieldValue.serverTimestamp(),
        // Attach a Firestore TTL policy to this field so the collection
        // doesn't grow forever:
        //   gcloud firestore fields ttls update expiresAt \
        //     --collection-group=_processedEvents --enable-ttl
        expiresAt: Timestamp.fromMillis(
          Date.now() + PROCESSED_EVENT_RETENTION_MS
        ),
      });
    } catch (err) {
      if ((err as {code?: number}).code === GRPC_ALREADY_EXISTS) {
        logger.info(`Event ${event.id} already processed, skipping`);
        response.status(200).json({received: true}).send();
        return;
      }
      throw err;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          logger.info("Handling a checkout session");
          const session = event.data.object as Stripe.Checkout.Session;
          const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
            session.id,
            {
              expand: [
                "line_items.data.price.product",
                "payment_intent.payment_method",
              ],
            }
          );

          // v1 and v2 share a Stripe account, so this endpoint also receives
          // v1's checkout events. Only sessions we created carry our tag.
          if (sessionWithLineItems.metadata?.app !== STRIPE_APP_TAG) {
            logger.info(
              `Ignoring session ${session.id}: not created by this app ` +
                `(app=${sessionWithLineItems.metadata?.app ?? "none"})`
            );
            break;
          }

          const eventType = sessionWithLineItems.metadata?.eventType ?? "-1";

          switch (parseInt(eventType)) {
            case StripeWebhookEventType.Registration:
              await fulfillRegistration(
                db,
                sessionWithLineItems,
                !isProd /* isTestData */
              );
              break;
            case StripeWebhookEventType.PreRegistration:
              await fulfillPreRegistrations(
                db,
                sessionWithLineItems,
                !isProd /* isTestData */
              );
              break;
            case StripeWebhookEventType.Donation:
              await sendMessageToRegistrationForCampChannel(
                `Donation: ${
                  (sessionWithLineItems?.amount_total ?? 0) / 100
                } from ${
                  sessionWithLineItems.customer_email ??
                  sessionWithLineItems.customer_details?.email ??
                  ""
                }`
              );
              break;
            default:
              logger.error(
                `Invalid event type: ${sessionWithLineItems.metadata?.eventType}`
              );
              sendMessageToRegistrationErrorMessages(
                `Invalid event type: ${sessionWithLineItems.metadata?.eventType}`
              );
          }
          break;
        }
        case "checkout.session.expired": {
          // Registration sessions hold camp spots (see createOrUpdateRegistration);
          // when the session lapses unpaid, hand them back.
          logger.info("Handling an expired checkout session");
          const session = event.data.object as Stripe.Checkout.Session;
          const sessionWithLineItems = await stripe.checkout.sessions.retrieve(
            session.id,
            {expand: ["line_items.data.price.product"]}
          );

          if (sessionWithLineItems.metadata?.app !== STRIPE_APP_TAG) {
            logger.info(
              `Ignoring expired session ${session.id}: not created by this app ` +
                `(app=${sessionWithLineItems.metadata?.app ?? "none"})`
            );
            break;
          }

          const eventType = sessionWithLineItems.metadata?.eventType ?? "-1";
          if (parseInt(eventType) === StripeWebhookEventType.Registration) {
            await releaseRegistrationHolds(db, sessionWithLineItems);
          } else {
            // Donation and pre-registration sessions hold nothing.
            logger.info(
              `Expired session ${session.id} (eventType=${eventType}) holds no spots`
            );
          }
          break;
        }
        default:
          logger.error("Unhandled event type");
      }
    } catch (error) {
      Sentry.captureException(error);
      logger.error("Failed to handle the event: ", error);
      sendMessageToRegistrationErrorMessages("Failed to handle an event");
      // Release the claim so Stripe's retry can reprocess this event.
      await eventRef.delete().catch((e) => logger.error(e));
      response.status(500).send();
      return;
    }

    await eventRef.update({processedAt: FieldValue.serverTimestamp()});

    response
      .status(200)
      .json({
        received: true,
      })
      .send();
  };
}

// Stripe calls these anonymously; authenticity is the signature check inside.
const webhookOptions = {cors: false, invoker: "public" as const};

export const handleStripeWebhook = onRequest(
  webhookOptions,
  withSentryRequest(
    "handleStripeWebhook",
    handleStripeWebhookHelper(true /* isProd */)
  )
);

export const handleTestStripeWebhook = onRequest(
  webhookOptions,
  withSentryRequest(
    "handleTestStripeWebhook",
    handleStripeWebhookHelper(false /* isProd */)
  )
);
