import * as Sentry from "@sentry/node";
import Stripe from "stripe";
import {
  DocumentReference,
  FieldValue,
  Firestore,
} from "firebase-admin/firestore";
import {logger} from "firebase-functions";

// Local imports
import {
  CampTrack,
  CampYear,
  Family,
  Payment,
  Registration,
  RegistrationStatus,
  validateCampCreditWrite,
  validateCampYearWrite,
  validatePaymentWrite,
  validateRegistrationWrite,
} from "lyf-registration-schemas";
import {RegistrationLineItemMetadata} from "./createRegistrationSession";
import {
  applySpotDelta,
  createDiscountName,
  DEFAULT_SIBLING_DISCOUNT,
  RemainingSpotsMap,
} from "../registrationUtils";
import {
  sendMessageToRegistrationForCampChannel,
  sendMessageToRegistrationErrorMessages,
} from "../slack/slackChannelWebhooks";
import {addParentsToMailchimpList} from "../utils/mailchimp";
import {RegistrationType} from "../utils";
import {getRegistrationAndCamperInfo} from "../registrationUtils/getRegistrationAndCamperInfo";
import {sendRegistrationEmail} from "../registrationUtils/sendRegistrationEmail";
import {isRegistrationLineItem} from "../stripe/lineItems";

/**
 * Small helper to calculate the discounts used while early-returning if we don't need to get the firestore object
 * @param db
 * @param discountAmount
 * @param campYearRef
 * @param numberOfRegistrations
 * @returns
 */
async function calculateDiscountAmounts(
  db: Firestore,
  discountAmount: number,
  campYearRef: DocumentReference<CampYear>,
  numberOfRegistrations: number
): Promise<number[]> {
  if (discountAmount <= 0) return [0, 0];

  const campYearInfo = (await campYearRef.get()).data();
  // Same default as createRegistrationSession, otherwise a camp year without
  // the field would have the whole coupon attributed to camp credit here.
  const siblingDiscount =
    campYearInfo?.siblingDiscount ?? DEFAULT_SIBLING_DISCOUNT;

  // Mirrors createRegistrationSession: the sibling discount is per paid
  // registration and can never exceed the discount Stripe actually applied.
  const siblingDiscountUsed = Math.min(
    Math.max(0, numberOfRegistrations - 1) * siblingDiscount,
    discountAmount
  );
  const campCreditUsed = Math.max(0, discountAmount - siblingDiscountUsed);

  return [siblingDiscountUsed, campCreditUsed];
}

/**
 * Finalize the registration by
 * 1. Sending confirmation emails for each of the registered campers
 * 2. Sending messages to the registration channel for each camper
 * 3. Adding the parents to the mailchimp list
 * 4. Updating the remaining spots for registrations that don't already hold one
 * 5. Subtracting camp credit if it was used
 *
 * @param db
 * @param isTestData
 * @param campYear
 * @param email
 * @param familyRef
 * @param registrationRefs
 * @param registrationDescriptions
 * @param campCreditUsed
 * @param campTrackSpots Tracks being registered for (used for the mailing
 *   list); the spot decrement itself is derived from the registration docs.
 */
export async function completeRegistration(
  db: Firestore,
  isTestData: boolean,
  campYear: string,
  email: string,
  familyRef: DocumentReference<Family>,
  registrationRefs: DocumentReference<Registration>[],
  registrationDescriptions: string[],
  campCreditUsed: number,
  campTrackSpots: Map<string, number>
) {
  // Send confirmation emails to registered campers
  await Promise.all(
    registrationRefs.map(async (ref) => {
      const {camper, camperHealth, registration} =
        await getRegistrationAndCamperInfo(db, ref);

      if (!camper || !registration) {
        await sendMessageToRegistrationErrorMessages(
          `Failed to send confirmation email to ${email} for ${
            registration?.camperName ?? ref.id
          }`
        );
        return;
      }

      logger.info(`Sending confirmation email to ${email}`);
      try {
        await sendRegistrationEmail(
          db,
          email,
          Number.parseInt(campYear),
          camper,
          registration,
          camperHealth
        );
      } catch (e) {
        Sentry.captureException(e);
        await sendMessageToRegistrationErrorMessages(
          `Failed to send confirmation email to ${email} for ${
            registration?.camperName ?? ref.id
          }`
        );
        logger.error(`Error sending confirmation email: ${e}`);
      }
    })
  );

  // Send messages to the registration channel for every camper
  await Promise.all(
    registrationDescriptions.map(async (description) => {
      try {
        await sendMessageToRegistrationForCampChannel(description, isTestData);
      } catch (e) {
        Sentry.captureException(e);
        logger.error(`Error sending slack message: ${e}`);
      }
    })
  );

  // Make sure the parents are signed up to the proper mailchimp list
  const parentCollectionRef = (familyRef as DocumentReference).collection(
    "parents"
  );
  await addParentsToMailchimpList(
    RegistrationType.Registration,
    parentCollectionRef,
    campYear,
    Array.from(campTrackSpots.keys()) as CampTrack[]
  );

  // Update the remaining spots. A registration that already holds a spot
  // (reserved in the registration transaction or by moveCampersOffWaitlist)
  // must not be counted twice, so only decrement for the ones whose
  // `spotReserved` is not set, and mark them reserved in the same transaction.
  if (registrationRefs.length > 0) {
    const campYearRef = db.collection("camps").doc(campYear);
    await db.runTransaction(async (t) => {
      const campYearDoc = await t.get(campYearRef);
      const registrationDocs = await t.getAll(...registrationRefs);

      const toReserve = registrationDocs.filter(
        (doc) => doc.exists && doc.data()?.spotReserved !== true
      );
      if (toReserve.length === 0) return;

      const campYear = campYearDoc.data() as CampYear;
      let remainingSpots: RemainingSpotsMap | undefined =
        campYear?.remainingSpots;
      toReserve.forEach((doc) => {
        const track = doc.data()?.campTrack;
        if (track && remainingSpots) {
          remainingSpots = applySpotDelta(remainingSpots, track, -1);
        }
        t.update(doc.ref, validateRegistrationWrite({spotReserved: true}));
      });

      // No camp year capacity data found so just flag the registrations
      if (!remainingSpots) return;
      t.update(campYearRef, validateCampYearWrite({remainingSpots}));
    });
  }

  // Subtract camp credit if it was used
  if (campCreditUsed > 0) {
    const familyId = (familyRef as DocumentReference).id;
    const message = `Used camp credit for ${email} from family ${familyId}`;
    logger.info(message);
    await sendMessageToRegistrationForCampChannel(message);

    const creditRef = db.collection("credits").doc(familyId);
    await creditRef.update(
      validateCampCreditWrite({
        amountRemaining: FieldValue.increment(-campCreditUsed),
        notes: FieldValue.arrayUnion(
          `-${campCreditUsed}: ${campYear} LYF Camp Registration`
        ),
      })
    );
  }
}

/**
 * Given a Stripe Checkout Session, parse the payment and fulfill the registration.
 * @param checkoutSession
 * @returns
 */
export async function fulfillRegistration(
  db: Firestore,
  checkoutSession: Stripe.Checkout.Session,
  isTestData: boolean
) {
  const lineItems = checkoutSession.line_items;
  const customerEmail =
    checkoutSession.customer_email ??
    checkoutSession.customer_details?.email ??
    "";
  const sessionMessage = `session ${checkoutSession.id} from ${customerEmail}`;

  logger.debug(`Fulfilling registration for ${sessionMessage}`);

  if (!lineItems) {
    logger.error("No line items found");
    sendMessageToRegistrationErrorMessages(
      `No line items found in ${sessionMessage}`
    );
    return;
  }

  if (checkoutSession.payment_status === "unpaid") {
    logger.warn(
      "Payment not yet completed, so we'll finish the registration later"
    );
    // We'll wait until the full payment is completed.
    return;
  }

  // Classified by the metadata we stamped on each product, not by the product
  // name: the name carries the camper's name, which the parent controls.
  const registrationLineItems = lineItems.data.filter(isRegistrationLineItem);
  const donation = lineItems.data.find(
    (item) => !isRegistrationLineItem(item)
  )?.amount_total;
  const paymentIntent = checkoutSession.payment_intent as Stripe.PaymentIntent;
  const paymentMethod = (paymentIntent.payment_method as Stripe.PaymentMethod)
    .type;

  // Set default values we'll update with metadata from the registration line items
  let campYear = "";
  let familyRef: DocumentReference | null = null;

  // Process the registration line items.
  const registrationRefs: DocumentReference<Registration>[] = [];
  const registrationDescriptions: string[] = [];
  const campTrackSpotsToSubtract = new Map<string, number>();
  await Promise.all(
    registrationLineItems.map(async (item) => {
      const product = item.price?.product as Stripe.Product;
      const metadata = product?.metadata as RegistrationLineItemMetadata;

      if (!metadata) {
        logger.error("No metadata found on line item: ", item);
        return;
      }

      logger.debug("Processing registration line item metadata", metadata);

      const registrationRef = db.doc(metadata.registrationRef);
      registrationRefs.push(registrationRef);
      registrationDescriptions.push(item.description);

      campTrackSpotsToSubtract.set(
        metadata.campTrack,
        (campTrackSpotsToSubtract.get(metadata.campTrack) ?? 0) + 1
      );

      // Assume that this is the same for every registration line item
      familyRef = db.doc(metadata.familyRef);
      campYear = metadata.campYear;
    })
  );

  // Create the camp year document reference
  if (campYear === "") {
    logger.error("Couldn't find camp year in any registration line items");
    sendMessageToRegistrationErrorMessages(
      `Couldn't find camp year in any registration line items ${sessionMessage}`
    );
    return;
  }
  const campYearRef = db.collection("camps").doc(campYear);

  // Process the discount
  const discountAmount =
    (checkoutSession.total_details?.amount_discount ?? 0) / 100;
  const [siblingDiscountUsed, campCreditUsed] = await calculateDiscountAmounts(
    db,
    discountAmount,
    campYearRef,
    registrationRefs.length
  );

  // Create a payment in the payments collection
  const paymentRef: DocumentReference<Payment> = await db
    .collection("payments")
    .doc(checkoutSession.id);
  await paymentRef.set(
    validatePaymentWrite({
      customerEmail: customerEmail,
      customerName: checkoutSession.customer_details?.name ?? "",
      customerId: (checkoutSession.customer as string) ?? "",

      donation: (donation || 0) / 100,
      discount:
        discountAmount > 0
          ? {
              amount: discountAmount,
              name: createDiscountName(siblingDiscountUsed, campCreditUsed),
            }
          : null,
      items: lineItems.data.map((item) => ({
        amount: item.amount_total / 100,
        description: item.description,
      })),

      paymentMethod: paymentMethod,
      registrations: FieldValue.arrayUnion(...registrationRefs),

      status: checkoutSession.payment_status,
      stripeId: checkoutSession.id,
      type: "Stripe",
      total: (checkoutSession.amount_total || 0) / 100,

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    {
      merge: true,
    }
  );

  // Link the payment to the registration and update the status to active
  await Promise.all(
    registrationRefs.map(async (ref) => {
      await ref.update(
        validateRegistrationWrite({
          payments: FieldValue.arrayUnion(paymentRef),
          status:
            checkoutSession.payment_status === "paid"
              ? RegistrationStatus.ACTIVE
              : RegistrationStatus.PROCESSING_PAYMENT,
          updatedAt: FieldValue.serverTimestamp(),
        })
      );
    })
  );

  // At this point even if the payment isn't fully processed, we should decrement the remaining spots.
  // This has to be done as an atomic operation to prevent

  // If the payment isn't yet paid, then we're done.
  if (checkoutSession.payment_status !== "paid") {
    await sendMessageToRegistrationForCampChannel(
      `Processing payment from: ${customerEmail}`,
      isTestData
    );

    return;
  }

  // Otherwise, we need to do some additional processing afterwards.
  if (!familyRef) {
    const message = `No family ref found for ${sessionMessage}`;
    logger.error(message);
    sendMessageToRegistrationErrorMessages(message);
    return;
  }

  await completeRegistration(
    db,
    isTestData,
    campYear,
    customerEmail,
    familyRef,
    registrationRefs,
    registrationDescriptions,
    campCreditUsed,
    campTrackSpotsToSubtract
  );
}
