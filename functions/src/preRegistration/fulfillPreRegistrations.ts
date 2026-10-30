import Stripe from "stripe";
import {FieldValue, Firestore} from "firebase-admin/firestore";
import {logger} from "firebase-functions";

// Local imports
import {
  MAX_GRADE,
  MIN_GRADE,
  RegistrationStatus,
  normalizeEmails,
  validateCamperWrite,
  validatePaymentWrite,
  validateRegistrationWrite,
} from "lyf-registration-schemas";
import {PreRegistrationLineItemMetadata} from "./createPreRegistrationSession";
import {
  sendMessageToRegistrationForCampChannel,
  sendMessageToRegistrationErrorMessages,
} from "../slack/slackChannelWebhooks";
import {addParentsToMailchimpList} from "../utils/mailchimp";
import {RegistrationType} from "../utils";
import {isPreRegistrationLineItem} from "../stripe/lineItems";

/**
 * Complete the Stripe webhook event that let us know a pre-registration succeeded.
 * @param checkoutSession
 * @returns
 */
export async function fulfillPreRegistrations(
  db: Firestore,
  checkoutSession: Stripe.Checkout.Session,
  isTestData: boolean
) {
  const lineItems = checkoutSession.line_items;
  const sessionMessage = `session ${checkoutSession.id} from ${checkoutSession.customer_email}`;
  if (!lineItems) {
    logger.error(`No line items found on ${sessionMessage}`);
    sendMessageToRegistrationErrorMessages(
      `No line items found on ${sessionMessage}`
    );
    return;
  }

  const isPendingPayment = checkoutSession.payment_status === "unpaid";

  if (isPendingPayment) {
    logger.warn(
      `Payment not yet completed, so we'll finish the pre-registration later on ${sessionMessage}`
    );
  }

  // Classified by the metadata we stamped on each product, not by the product
  // name: the name carries the camper's name, which the parent controls.
  const lineItemsWithoutDonation = lineItems.data.filter(
    isPreRegistrationLineItem
  );
  const donation = lineItems.data.find(
    (item) => !isPreRegistrationLineItem(item)
  )?.amount_total;

  // Add a payment to our Stripe database
  const paymentIntent = checkoutSession.payment_intent as Stripe.PaymentIntent;
  const paymentMethod = (paymentIntent.payment_method as Stripe.PaymentMethod)
    .type;

  const paymentRef = db.collection("payments").doc(paymentIntent.id);

  // Stripe types these as nullable; Payment stores strings, so fall back to
  // "" the way fulfillRegistration does rather than writing null.
  const customer = checkoutSession.customer;
  const customerId =
    typeof customer === "string" ? customer : (customer?.id ?? "");

  await paymentRef.set(
    validatePaymentWrite({
      customerEmail: checkoutSession.customer_details?.email ?? "",
      customerName: checkoutSession.customer_details?.name ?? "",
      customerId,
      donation: (donation || 0) / 100,
      items: lineItemsWithoutDonation.map((item) => ({
        amount: item.amount_total / 100,
        description: item.description,
      })),
      stripeId: paymentIntent.id,
      total: (checkoutSession.amount_total || 0) / 100,
      type: "Stripe",
      paymentMethod: paymentMethod,
      status: checkoutSession.payment_status,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    {
      merge: true,
    }
  );

  // Pre-Register the campers
  await Promise.all(
    lineItemsWithoutDonation.map(async (item, index) => {
      const product = item.price?.product as Stripe.Product;
      const metadata = product?.metadata as PreRegistrationLineItemMetadata;

      if (!metadata) {
        logger.error("No metadata found on line item: ", item);
        sendMessageToRegistrationErrorMessages(
          `No metadata found on line item with index ${index} on ${sessionMessage}`
        );
        return;
      }

      const {campYear, camperName, camperRefString, currentGradeString} =
        metadata;

      if (campYear === "") {
        logger.error(
          `Couldn't find camp year in the pre-registration line items on ${sessionMessage}`
        );
        sendMessageToRegistrationErrorMessages(
          `Couldn't find camp year in the pre-registration line items on ${sessionMessage}`
        );
        return;
      }

      // Create all the references and data used to create the pre-registration
      const nextYearsCamp = db
        .collection("camps")
        .doc(campYear)
        .collection("registrations");
      const camperRef = db.doc(camperRefString);
      // Grade is "the grade the camper will complete", so next year's is one
      // more. Only written when it is a real grade: the metadata is a string
      // (possibly empty), and a grade past MAX_GRADE has nowhere to go.
      const nextYearGrade =
        currentGradeString != "" ? parseInt(currentGradeString) + 1 : NaN;
      const hasNextYearGrade =
        Number.isInteger(nextYearGrade) &&
        nextYearGrade >= MIN_GRADE &&
        nextYearGrade <= MAX_GRADE;
      if (currentGradeString != "" && !hasNextYearGrade) {
        logger.warn(
          `Skipping grade for ${camperName}: "${currentGradeString}" + 1 is not a valid grade`
        );
      }

      // Look up the family's emails for ownership-scoped Firestore rules.
      // Family.emails are already normalized; normalize again so a legacy
      // document cannot leak an un-normalized key onto the registration.
      const familyRef = camperRef.parent.parent;
      let familyEmails: string[] = [];
      if (familyRef) {
        const familyDoc = await familyRef.get();
        familyEmails = normalizeEmails(familyDoc.data()?.emails ?? []);
      }

      // Create a pre-registration for next year's camp.
      const preRegistrationRef = nextYearsCamp.doc(camperRef.id);
      await preRegistrationRef.set(
        validateRegistrationWrite({
          // If the payment isn't completed yet, then mark the camper as pending payment.
          status: isPendingPayment
            ? RegistrationStatus.PENDING_PAYMENT
            : RegistrationStatus.PARTIAL_PAYMENT,
          amountPaid: FieldValue.increment(
            isPendingPayment ? 0 : item.amount_subtotal / 100
          ),
          ...(hasNextYearGrade ? {grade: nextYearGrade} : {}),
          isPreRegistered: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          camper: camperRef,
          camperName: camperName,
          payments: FieldValue.arrayUnion(paymentRef),
          familyEmails: familyEmails,
        }),
        {
          merge: true,
        }
      );

      // Associate that pre-registration with the camper.
      await camperRef.update(
        validateCamperWrite({
          registrations: FieldValue.arrayUnion(preRegistrationRef),
        })
      );

      // Send a message to our Slack channel
      await sendMessageToRegistrationForCampChannel(
        isPendingPayment
          ? `Processing payment from: ${checkoutSession.customer_email}`
          : item.description,
        isTestData
      );

      // If this is the last item, then update the parent's mailchimp info as well.
      // This is a bit hacky but we couldn't put this after the loop if we wanted all of them to be processed in parallel.
      const parentCollectionRef =
        camperRef.parent.parent?.collection("parents");
      if (
        index === lineItemsWithoutDonation.length - 1 &&
        parentCollectionRef
      ) {
        await addParentsToMailchimpList(
          RegistrationType.PreRegistration,
          parentCollectionRef,
          campYear
        );
      }
    })
  );

  logger.info(
    `Successfully recorded payment from ${checkoutSession.customer_details?.email} with status: ${checkoutSession.payment_status}`
  );
}
