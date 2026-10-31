import * as Sentry from "@sentry/node";
import Stripe from "stripe";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";

// Local imports
import {
  createStripeCheckoutSession,
  LineItem,
} from "../stripe/createStripeCheckoutSession";
import {getStripeCustomerId} from "../registrationUtils";
import {getFirestoreDb, StripeWebhookEventType} from "../utils";
import {
  callableOptions,
  resolveTestDataFlag,
  validateDollarAmount,
  validateRedirectUrl,
} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";
import {parseCallablePayload} from "../utils/validate";

// Import schema
import {
  CampYear,
  PreRegistrationInputPayload,
  validatePreRegistrationPayload,
} from "lyf-registration-schemas";

export interface PreRegistrationLineItemMetadata extends Stripe.Metadata {
  campYear: string;
  camperName: string;
  camperRefString: string;
  currentGradeString: string;
}

export const createPreRegistrationSession = onCall<PreRegistrationInputPayload>(
  callableOptions,
  withSentryCallable("createPreRegistrationSession", async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Not signed in");
    }

    const {
      campersToPreRegister,
      camperRefsToPreRegister,
      camperCurrentGrades,
      campYear,
      donationAmount,
      email,
      successUrl,
      cancelUrl,
      isTestData: requestedTestData = false,
    } = parseCallablePayload(validatePreRegistrationPayload, request.data);

    const authEmail = request.auth.token.email;
    if (!authEmail || authEmail.toLowerCase() !== email.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "The provided email does not match your authenticated account"
      );
    }

    validateRedirectUrl(successUrl);
    validateRedirectUrl(cancelUrl);
    if (donationAmount > 0) {
      validateDollarAmount(donationAmount, "donationAmount", 10000);
    }

    const isTestData = await resolveTestDataFlag(request, requestedTestData);
    const db = getFirestoreDb(!isTestData);

    // H1: Verify caller owns every camper ref before embedding in Stripe metadata
    for (const camperRefString of camperRefsToPreRegister) {
      const camperDoc = db.doc(camperRefString);
      const familyRef = camperDoc.parent.parent;
      if (!familyRef) {
        throw new HttpsError(
          "invalid-argument",
          "Invalid camper reference path"
        );
      }
      const familyDoc = await familyRef.get();
      const familyEmails: string[] = (familyDoc.data()?.emails ?? []).map(
        (e: string) => e.toLowerCase()
      );
      if (!familyEmails.includes(authEmail.toLowerCase())) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to pre-register this camper"
        );
      }
      // The path is stamped into Stripe metadata and written to on
      // fulfilment; a camper that does not exist would take the payment and
      // then fail the webhook (no pre-registration, retries for days).
      if (!(await camperDoc.get()).exists) {
        throw new HttpsError(
          "not-found",
          `Camper ${camperDoc.id} was not found in your family`
        );
      }
    }

    const camperCurrentGradesString = camperCurrentGrades?.map((grade) =>
      grade ? grade.toString() : ""
    );

    // Price comes from the camp year document so next year's fee is a data
    // change, not a deploy. Fall back to the historical $500 if unset.
    const campDoc = await db
      .collection("camps")
      .doc(campYear.toString())
      .get();
    const preRegistrationFee =
      (campDoc.data() as CampYear | undefined)?.preRegistrationFee ?? 500;

    const stripeLineItems: LineItem<PreRegistrationLineItemMetadata>[] =
      campersToPreRegister.map((name, index) => ({
        priceInDollars: preRegistrationFee,
        name: `TACL LYF Camp ${campYear} Pre-Registration: ${name}`,
        metadata: {
          campYear: campYear.toString(),
          camperName: name,
          camperRefString: camperRefsToPreRegister[index],
          currentGradeString:
            camperCurrentGradesString &&
            camperCurrentGradesString.length > index
              ? camperCurrentGradesString[index]
              : "",
        },
      }));

    if (donationAmount > 0) {
      stripeLineItems.push({
        priceInDollars: donationAmount,
        name: "Donation",
      });
    }

    const parentRef =
      camperRefsToPreRegister.length > 0
        ? db
            .doc(camperRefsToPreRegister[0])
            .parent.parent?.collection("parents")
            .doc(email)
        : undefined;

    const paymentDescription =
      campersToPreRegister.length <= 0
        ? "LYF Camp Donation"
        : `LYF Camp ${campYear} Pre-Registration - ${campersToPreRegister.join(
            ", "
          )}${donationAmount > 0 ? " + Donation" : ""}`;

    try {
      const stripeCustomerId = await getStripeCustomerId(
        parentRef,
        email,
        isTestData
      );
      const result = await createStripeCheckoutSession(
        stripeLineItems,
        successUrl,
        cancelUrl,
        stripeCustomerId,
        StripeWebhookEventType.PreRegistration,
        paymentDescription,
        isTestData,
        null /* discount */
      );
      return {sessionId: result.id};
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);
      return {
        status: "error",
        code: 402,
        message: "Failed to create a Stripe Checkout session",
      };
    }
  })
);
