/**
 * Sibling discount applied when the camp year document does not set one.
 * Shared by session creation and the Stripe webhook so both sides split a
 * coupon into sibling discount vs camp credit the same way.
 */
export const DEFAULT_SIBLING_DISCOUNT = 80;

export type RegistrationChargesInput = {
  /** Sum of the per-camper prices for the campers who actually have a spot. */
  registeredCost: number;
  /** Number of campers who actually have a spot (waitlisted campers excluded). */
  registeredCount: number;
  /** Discount per additional paid sibling, from the camp year document. */
  siblingDiscount: number;
  /** Camp credit the family has left, from the credits document. */
  campCreditRemaining: number;
};

export type RegistrationCharges = {
  /** Sibling discount actually applied; never exceeds registeredCost. */
  siblingDiscountAmount: number;
  /** Cost after the sibling discount, floored at zero. */
  costAfterSiblingDiscount: number;
  /** Camp credit actually consumed; never exceeds costAfterSiblingDiscount. */
  campCreditUsed: number;
  /** What is left to charge through Stripe. */
  amountDue: number;
  /** True when nothing needs to be charged (e.g. full financial aid). */
  isFullyCovered: boolean;
};

/**
 * Server-side pricing for a registration request. Nothing here comes from the
 * client except, indirectly, how many campers ended up with a spot.
 *
 * The sibling discount is per *paid* sibling, so it is computed from the
 * number of registered campers, not from the size of the request: waitlisted
 * campers are not charged and must not earn a discount for the ones who are.
 * Every amount is clamped so a discount can never exceed what is being
 * charged and the total can never go negative.
 */
export function computeRegistrationCharges({
  registeredCost,
  registeredCount,
  siblingDiscount,
  campCreditRemaining,
}: RegistrationChargesInput): RegistrationCharges {
  const safeCost = Math.max(0, registeredCost);
  const paidSiblings = Math.max(0, registeredCount - 1);

  const siblingDiscountAmount = Math.min(
    Math.max(0, siblingDiscount) * paidSiblings,
    safeCost
  );
  const costAfterSiblingDiscount = Math.max(
    0,
    safeCost - siblingDiscountAmount
  );

  const campCreditUsed = Math.min(
    costAfterSiblingDiscount,
    Math.max(0, campCreditRemaining)
  );
  const amountDue = Math.max(0, costAfterSiblingDiscount - campCreditUsed);

  return {
    siblingDiscountAmount,
    costAfterSiblingDiscount,
    campCreditUsed,
    amountDue,
    isFullyCovered: amountDue <= 0,
  };
}
