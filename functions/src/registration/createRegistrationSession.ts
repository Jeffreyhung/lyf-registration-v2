import * as Sentry from "@sentry/node";
import Stripe from "stripe";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";

// Local imports
import {
  createStripeCheckoutSession,
  LineItem,
} from "../stripe/createStripeCheckoutSession";
import {getFirestoreDb, StripeWebhookEventType} from "../utils";
import {
  sendMessageToRegistrationErrorMessages,
  sendMessageToRegistrationForCampChannel,
} from "../slack/slackChannelWebhooks";
import {
  computeRegistrationCharges,
  createDiscountName,
  DEFAULT_SIBLING_DISCOUNT,
  getStripeCustomerId,
} from "../registrationUtils";
import {createRegistrationDonationSession} from "../donation/createDonationSession";
import {createOrUpdateRegistration} from "./createOrUpdateRegistration";
import {
  callableOptions,
  resolveForceWaitlistFlag,
  resolveTestDataFlag,
  validateDollarAmount,
  validateRedirectUrl,
  validateRegistrationPayloadShape,
} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";

// Import schema
import {
  CampTrack,
  CampYear,
  getRegistrationPrice,
  RegistrationPayload,
  RegistrationStatus,
} from "lyf-registration-schemas";
import {sendWaitlistEmail} from "../registrationUtils/sendWaitlistEmail";
import {completeRegistration} from "./fullfillRegistration";
import {FieldValue} from "firebase-admin/firestore";

export interface RegistrationLineItemMetadata extends Stripe.Metadata {
  familyRef: string;
  registrationRef: string;
  campYear: string;
  campTrack: string;
}

export const createRegistrationSession = onCall<RegistrationPayload>(
  callableOptions,
  withSentryCallable("createRegistrationSession", async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Not signed in");
    }

    const {
      campYear,
      parents,
      campers,
      donation,
      successUrl,
      cancelUrl,
      isTestData: requestedTestData = false,
      forceWaitlist: requestedForceWaitlist = false,
    } = request.data;

    validateRegistrationPayloadShape(request.data);
    validateRedirectUrl(successUrl);
    validateRedirectUrl(cancelUrl);
    if (donation > 0) {
      validateDollarAmount(donation, "donation", 10000);
    }

    const isTestData = await resolveTestDataFlag(request, requestedTestData);
    const forceWaitlist = await resolveForceWaitlistFlag(
      request,
      requestedForceWaitlist
    );
    const db = getFirestoreDb(!isTestData);

    // Get the registration pricing. campYear comes from the client, so refuse
    // anything that does not resolve to a camp with a real price: a missing or
    // unpriced camp document would otherwise yield a $0 registration that is
    // treated as fully covered and activated without payment.
    const campRef = db.collection("camps").doc(campYear.toString());
    const campSnapshot = await campRef.get();
    if (!campSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        `Registration is not open for camp year ${campYear}`
      );
    }
    const campData = campSnapshot.data() as CampYear;
    const campPrice = getRegistrationPrice(campData);
    if (!Number.isFinite(campPrice) || campPrice <= 0) {
      logger.error(
        `Camp ${campYear} has no registration fee configured; refusing to register`
      );
      throw new HttpsError(
        "failed-precondition",
        `Registration pricing is not configured for camp year ${campYear}`
      );
    }
    const campPreRegistrationFee = campData?.preRegistrationFee ?? 500;
    const siblingDiscount =
      campData?.siblingDiscount ?? DEFAULT_SIBLING_DISCOUNT;
    const remainingSpots = campData?.remainingSpots ?? {
      [CampTrack.YOUNGER]: 0,
      [CampTrack.OLDER]: 0,
    };

    // Update the family, parent, camper, and registration info accordingly
    const {familyRef, parentRefs, camperAndStatuses} =
      await createOrUpdateRegistration(
        db,
        request.data,
        remainingSpots,
        forceWaitlist,
        request.auth.token.email!
      );

    // Assume the first parent is the signed in parent.
    const signedInParentRef = parentRefs[0];
    const signedInParentEmail =
      request.auth.token.email ?? (parents[0].email?.toLowerCase() as string);

    const waitlistedCampers = camperAndStatuses.filter(
      ({isWaitlisted}) => isWaitlisted
    );
    const registeredCampers = camperAndStatuses.filter(
      ({isWaitlisted}) => !isWaitlisted
    );
    const allWaitlisted = waitlistedCampers.length === campers.length;
    const hasWaitlistedCampers = waitlistedCampers.length > 0;

    // Send waitlist message to camp channel for all waitlisted campers.
    await Promise.all(
      waitlistedCampers.map(async ({camperName, campTrack}) => {
        await sendMessageToRegistrationForCampChannel(
          `LYF Camp ${campYear} Waitlist: ${camperName}`,
          isTestData
        );

        // TODO: Replace this with an individualized waitlist email once we have that ready.
        await sendWaitlistEmail(
          signedInParentEmail,
          campYear,
          campTrack,
          camperName
        );
      })
    );

    // If all the campers are waitlisted, then that means we can early return.
    if (allWaitlisted) {
      // If there's no donation, then we can just return from here.
      if (donation <= 0) {
        return {
          status: "success",
          code: 200,
          sessionId: null,
          isWaitlist: true,
        };
      }

      return await createRegistrationDonationSession(
        campYear,
        donation,
        signedInParentRef,
        signedInParentEmail,
        successUrl,
        cancelUrl,
        true, // isWaitlist
        isTestData
      );
    }

    let registeredCost = 0;
    const stripeLineItems: LineItem<RegistrationLineItemMetadata>[] = [];

    // Create Stripe line items for the registrations.
    await Promise.all(
      registeredCampers.map(
        async ({camperName, campTrack, registrationRef}) => {
          const regData = (await registrationRef.get()).data();
          const isPreRegistered = regData?.isPreRegistered ?? false;
          const registrationCost =
            campPrice - (isPreRegistered ? campPreRegistrationFee : 0);

          registeredCost += registrationCost;
          stripeLineItems.push({
            priceInDollars: registrationCost,
            name: `LYF Camp ${campYear} Registration${
              isPreRegistered ? " for Pre-Registered Camper" : ""
            }: ${camperName}`,
            metadata: {
              familyRef: familyRef.path,
              registrationRef: registrationRef.path,
              // Metadata can only be strings, and even enums have to be converted to strings.
              campYear: campYear.toString(),
              campTrack: campTrack.toString(),
            },
          });
        }
      )
    );

    // We don't trust any discounts applied from the client-side, so re-compute them here.
    // The discount is per *paid* sibling: waitlisted campers are not charged, so
    // they must not count, or a request padded with waitlisted campers could
    // discount the paid ones down to nothing (see computeRegistrationCharges).
    const campCredit = await db.collection("credits").doc(familyRef.id).get();
    const {siblingDiscountAmount, campCreditUsed, isFullyCovered} =
      computeRegistrationCharges({
        registeredCost,
        registeredCount: registeredCampers.length,
        siblingDiscount,
        campCreditRemaining: campCredit.data()?.amountRemaining ?? 0,
      });

    // At this point, if they have more camp credit than the total registration cost
    // (i.e. financial aid), then we just need to immediately return or create a donation session
    if (isFullyCovered) {
      // Complete the registrations. Only the campers who have a spot become
      // active; waitlisted campers in the same request stay on the waitlist.
      const campTrackSpots = new Map<string, number>();
      await Promise.all(
        registeredCampers.map(async (c) => {
          await c.registrationRef.update({
            status: RegistrationStatus.ACTIVE,
            updatedAt: FieldValue.serverTimestamp(),
          });

          campTrackSpots.set(
            c.campTrack,
            (campTrackSpots.get(c.campTrack) ?? 0) + 1
          );
        })
      );

      await completeRegistration(
        db,
        isTestData,
        campYear.toString(),
        signedInParentEmail,
        familyRef,
        registeredCampers.map((c) => c.registrationRef),
        stripeLineItems.map((s) => s.name),
        campCreditUsed,
        campTrackSpots
      );

      // If there's no donation, then we can just return from here.
      if (donation <= 0) {
        return {
          status: "success",
          code: 200,
          sessionId: null,
          isWaitlist: hasWaitlistedCampers,
        };
      }

      return await createRegistrationDonationSession(
        campYear,
        donation,
        signedInParentRef,
        signedInParentEmail,
        hasWaitlistedCampers ? `${successUrl}&waitlist=1` : successUrl,
        cancelUrl,
        hasWaitlistedCampers, // isWaitlist
        isTestData
      );
    }

    // Otherwise, we'll continue with the checkout session creation
    const camperNames = registeredCampers
      .map(({camperName}) => camperName)
      .join(", ");
    const paymentDescription = `TACL-LYF Camp ${campYear} Registration for ${camperNames}${
      donation > 0 ? " + Donation" : ""
    }`;

    // If the user included a donation, then add that line item.
    if (donation > 0) {
      stripeLineItems.push({
        priceInDollars: donation,
        name: "Donation",
      });
    }

    const totalOff = siblingDiscountAmount + campCreditUsed;
    const discount =
      totalOff > 0
        ? {
            name: createDiscountName(siblingDiscountAmount, campCreditUsed),
            amount: totalOff,
          }
        : null;

    const customerId = await getStripeCustomerId(
      signedInParentRef,
      signedInParentEmail,
      isTestData
    ).catch((e) => {
      Sentry.captureException(e);
      logger.error(e);
      return null;
    });

    if (!customerId) {
      sendMessageToRegistrationErrorMessages(
        `Failed to create Stripe Customer: ${signedInParentEmail}`
      );
      return {
        status: "error",
        code: 402,
        message: "Failed to create the Stripe Customer",
      };
    }

    try {
      const session = await createStripeCheckoutSession(
        stripeLineItems,
        hasWaitlistedCampers ? `${successUrl}&waitlist=1` : successUrl,
        cancelUrl,
        customerId,
        StripeWebhookEventType.Registration,
        paymentDescription,
        isTestData,
        discount
      );
      return {
        status: "success",
        code: 200,
        sessionId: session.id,
        isWaitlist: hasWaitlistedCampers,
      };
    } catch (e) {
      Sentry.captureException(e);
      logger.error(e);
      sendMessageToRegistrationErrorMessages(
        `Failed to create a Stripe Checkout session: ${signedInParentEmail}`
      );
      return {
        status: "error",
        code: 402,
        message: "Failed to create a Stripe Checkout session",
      };
    }
  })
);
