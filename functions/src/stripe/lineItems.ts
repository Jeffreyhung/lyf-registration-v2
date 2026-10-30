import Stripe from "stripe";

/**
 * Helpers for telling the line items of a fulfilled checkout session apart.
 *
 * Every registration and pre-registration line item is created with product
 * metadata (see createRegistrationSession / createPreRegistrationSession);
 * the donation line item is created with none. The product *name*, on the
 * other hand, contains the camper's name as the parent typed it, so matching
 * on the description ("Donation", "Registration") let a camper called, say,
 * "Donation" be dropped from fulfilment or mis-recorded as a donation. These
 * helpers classify by the metadata we stamped ourselves.
 */

/** The product metadata on a line item, if its product was expanded. */
export function lineItemMetadata(
  item: Stripe.LineItem
): Stripe.Metadata | undefined {
  const product = item.price?.product;
  if (!product || typeof product === "string" || product.deleted) {
    return undefined;
  }
  return product.metadata;
}

function hasMetadataKey(item: Stripe.LineItem, key: string): boolean {
  const value = lineItemMetadata(item)?.[key];
  return typeof value === "string" && value !== "";
}

/** True for a camp registration line item (metadata.registrationRef set). */
export function isRegistrationLineItem(item: Stripe.LineItem): boolean {
  return hasMetadataKey(item, "registrationRef");
}

/** True for a pre-registration line item (metadata.camperRefString set). */
export function isPreRegistrationLineItem(item: Stripe.LineItem): boolean {
  return hasMetadataKey(item, "camperRefString");
}
