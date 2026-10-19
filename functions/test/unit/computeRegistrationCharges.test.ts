import {
  computeRegistrationCharges,
  DEFAULT_SIBLING_DISCOUNT,
} from "../../src/registrationUtils/computeRegistrationCharges";

const PRICE = 700;

describe("computeRegistrationCharges", () => {
  it("charges a single camper full price with no sibling discount", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE,
      registeredCount: 1,
      siblingDiscount: 80,
      campCreditRemaining: 0,
    });

    expect(result).toEqual({
      siblingDiscountAmount: 0,
      costAfterSiblingDiscount: PRICE,
      campCreditUsed: 0,
      amountDue: PRICE,
      isFullyCovered: false,
    });
  });

  it("discounts each additional paid sibling", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE * 3,
      registeredCount: 3,
      siblingDiscount: 80,
      campCreditRemaining: 0,
    });

    expect(result.siblingDiscountAmount).toBe(160);
    expect(result.amountDue).toBe(PRICE * 3 - 160);
    expect(result.isFullyCovered).toBe(false);
  });

  it("gives no discount for campers who only padded the request onto the waitlist", () => {
    // A request with ten campers where nine are waitlisted pays for one camper.
    // Before the fix the discount was (10 - 1) * 80 = 720 > 700, i.e. free camp.
    const result = computeRegistrationCharges({
      registeredCost: PRICE,
      registeredCount: 1,
      siblingDiscount: 80,
      campCreditRemaining: 0,
    });

    expect(result.siblingDiscountAmount).toBe(0);
    expect(result.amountDue).toBe(PRICE);
  });

  it("caps the sibling discount at the registered cost", () => {
    const result = computeRegistrationCharges({
      registeredCost: 100,
      registeredCount: 5,
      siblingDiscount: 80,
      campCreditRemaining: 0,
    });

    expect(result.siblingDiscountAmount).toBe(100);
    expect(result.costAfterSiblingDiscount).toBe(0);
    expect(result.amountDue).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("never lets any amount go negative", () => {
    const result = computeRegistrationCharges({
      registeredCost: -500,
      registeredCount: -3,
      siblingDiscount: -80,
      campCreditRemaining: -1000,
    });

    expect(result.siblingDiscountAmount).toBe(0);
    expect(result.costAfterSiblingDiscount).toBe(0);
    expect(result.campCreditUsed).toBe(0);
    expect(result.amountDue).toBe(0);
  });

  it("ignores a negative sibling discount from a misconfigured camp year", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE * 2,
      registeredCount: 2,
      siblingDiscount: -80,
      campCreditRemaining: 0,
    });

    expect(result.siblingDiscountAmount).toBe(0);
    expect(result.amountDue).toBe(PRICE * 2);
  });

  it("ignores negative camp credit", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE,
      registeredCount: 1,
      siblingDiscount: 80,
      campCreditRemaining: -200,
    });

    expect(result.campCreditUsed).toBe(0);
    expect(result.amountDue).toBe(PRICE);
  });

  it("uses partial camp credit and leaves the rest due", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE * 2,
      registeredCount: 2,
      siblingDiscount: 80,
      campCreditRemaining: 300,
    });

    expect(result.siblingDiscountAmount).toBe(80);
    expect(result.campCreditUsed).toBe(300);
    expect(result.amountDue).toBe(PRICE * 2 - 80 - 300);
    expect(result.isFullyCovered).toBe(false);
  });

  it("covers the whole cost with camp credit without consuming more than needed", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE * 2,
      registeredCount: 2,
      siblingDiscount: 80,
      campCreditRemaining: 5000,
    });

    expect(result.campCreditUsed).toBe(PRICE * 2 - 80);
    expect(result.amountDue).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("treats credit exactly equal to the cost as fully covered", () => {
    const result = computeRegistrationCharges({
      registeredCost: PRICE,
      registeredCount: 1,
      siblingDiscount: 80,
      campCreditRemaining: PRICE,
    });

    expect(result.campCreditUsed).toBe(PRICE);
    expect(result.amountDue).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("handles zero registered campers", () => {
    const result = computeRegistrationCharges({
      registeredCost: 0,
      registeredCount: 0,
      siblingDiscount: 80,
      campCreditRemaining: 100,
    });

    expect(result.siblingDiscountAmount).toBe(0);
    expect(result.campCreditUsed).toBe(0);
    expect(result.amountDue).toBe(0);
    expect(result.isFullyCovered).toBe(true);
  });

  it("always splits the cost into discount + credit + amount due", () => {
    const cases = [
      {registeredCost: 2100, registeredCount: 3, siblingDiscount: 80, campCreditRemaining: 0},
      {registeredCost: 2100, registeredCount: 3, siblingDiscount: 80, campCreditRemaining: 999},
      {registeredCost: 2100, registeredCount: 3, siblingDiscount: 80, campCreditRemaining: 99999},
      {registeredCost: 50, registeredCount: 4, siblingDiscount: 80, campCreditRemaining: 10},
      {registeredCost: 1400, registeredCount: 2, siblingDiscount: 0, campCreditRemaining: 100},
    ];

    for (const input of cases) {
      const {siblingDiscountAmount, campCreditUsed, amountDue} =
        computeRegistrationCharges(input);
      expect(siblingDiscountAmount + campCreditUsed + amountDue).toBe(
        input.registeredCost
      );
    }
  });

  it("exposes the default sibling discount shared with the Stripe webhook", () => {
    expect(DEFAULT_SIBLING_DISCOUNT).toBe(80);
  });
});
