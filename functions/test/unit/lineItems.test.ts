import type Stripe from "stripe";

import {
  isPreRegistrationLineItem,
  isRegistrationLineItem,
  lineItemMetadata,
} from "../../src/stripe/lineItems";

/** A line item as the webhook sees it after expanding line_items.data.price.product. */
function lineItem(
  description: string,
  metadata: Record<string, string> | undefined,
  product: "expanded" | "id" | "deleted" = "expanded"
): Stripe.LineItem {
  const expanded =
    product === "id" ?
      "prod_123" :
      product === "deleted" ?
        {id: "prod_123", object: "product", deleted: true} :
        {id: "prod_123", object: "product", metadata: metadata ?? {}};
  return {
    id: "li_1",
    object: "item",
    description,
    amount_total: 10000,
    amount_subtotal: 10000,
    price: {id: "price_1", object: "price", product: expanded},
  } as unknown as Stripe.LineItem;
}

const registration = lineItem("LYF Camp 2026 Registration: Ada Lovelace", {
  familyRef: "families/fam1",
  registrationRef: "camps/2026/registrations/cam1",
  campYear: "2026",
  campTrack: "Older",
});
const preRegistration = lineItem("TACL LYF Camp 2027 Pre-Registration: Ada", {
  campYear: "2027",
  camperName: "Ada",
  camperRefString: "families/fam1/campers/cam1",
  currentGradeString: "6",
});
// Donation line items are created without metadata; Stripe returns {}.
const donation = lineItem("Donation", {});

describe("lineItemMetadata", () => {
  it("returns the expanded product's metadata", () => {
    expect(lineItemMetadata(registration)?.registrationRef).toBe(
      "camps/2026/registrations/cam1"
    );
  });

  it("returns undefined when the product is not expanded or was deleted", () => {
    expect(lineItemMetadata(lineItem("x", {a: "b"}, "id"))).toBeUndefined();
    expect(lineItemMetadata(lineItem("x", {a: "b"}, "deleted"))).toBeUndefined();
  });
});

describe("isRegistrationLineItem / isPreRegistrationLineItem", () => {
  it("classifies by the metadata we stamped, not by the description", () => {
    expect(isRegistrationLineItem(registration)).toBe(true);
    expect(isRegistrationLineItem(donation)).toBe(false);
    expect(isRegistrationLineItem(preRegistration)).toBe(false);

    expect(isPreRegistrationLineItem(preRegistration)).toBe(true);
    expect(isPreRegistrationLineItem(donation)).toBe(false);
    expect(isPreRegistrationLineItem(registration)).toBe(false);
  });

  it("is not fooled by a camper whose name contains a keyword", () => {
    const trickyRegistration = lineItem(
      "LYF Camp 2026 Registration: Donation Smith",
      {
        familyRef: "families/fam1",
        registrationRef: "camps/2026/registrations/cam9",
        campYear: "2026",
        campTrack: "Younger",
      }
    );
    const trickyPreRegistration = lineItem(
      "TACL LYF Camp 2027 Pre-Registration: Donation Smith",
      {
        campYear: "2027",
        camperName: "Donation Smith",
        camperRefString: "families/fam1/campers/cam9",
        currentGradeString: "",
      }
    );
    const trickyDonation = lineItem("Registration Donation", {});

    expect(isRegistrationLineItem(trickyRegistration)).toBe(true);
    expect(isPreRegistrationLineItem(trickyPreRegistration)).toBe(true);
    expect(isRegistrationLineItem(trickyDonation)).toBe(false);
    expect(isPreRegistrationLineItem(trickyDonation)).toBe(false);
  });

  it("ignores an empty metadata value", () => {
    expect(
      isRegistrationLineItem(lineItem("Registration: Ada", {registrationRef: ""}))
    ).toBe(false);
  });
});
