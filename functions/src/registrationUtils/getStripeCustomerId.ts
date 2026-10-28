import {DocumentReference} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {validateParentWrite} from "lyf-registration-schemas";

// Local imports
import {getStripe} from "../utils";

/**
 * Given a reference to a parent document, create a customerId by retrieving it from the document or creating a new one.
 * @param parentRef
 * @param email
 * @returns
 */
export async function getStripeCustomerId(
  parentRef: DocumentReference | undefined,
  email: string,
  isTestData: boolean = false
): Promise<string> {
  const stripe = getStripe(!isTestData);
  // Fallback on creating a new customer.
  if (!parentRef) {
    logger.warn("No parent was found.");
    return (
      await stripe.customers.create({
        email: email,
      })
    ).id;
  }
  const parentData = (await parentRef.get()).data();

  if (!parentData) {
    logger.warn("No data found for the parentRef", parentRef.path);
    return (
      await stripe.customers.create({
        email: email,
      })
    ).id;
  }

  const customerId = parentData.stripeCustomerId as string | undefined;
  if (customerId) {
    logger.info("Found an existing stripe customer");
    return customerId;
  }

  // No customerId found so create a new one
  const customer = await stripe.customers.create({
    name: `${parentData.firstName} ${parentData.lastName}`,
    email: email,
  });

  await parentRef.update(
    validateParentWrite({
      stripeCustomerId: customer.id,
    })
  );

  logger.info(`Created a new customer id: ${customer.id}`);

  return customer.id;
}
