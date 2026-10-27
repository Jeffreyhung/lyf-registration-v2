import {createDiscountName} from "../../src/registrationUtils/createDiscountName";

describe("createDiscountName", () => {
  it("is empty when there is no discount", () => {
    expect(createDiscountName(0, 0)).toBe("");
  });

  it("names a sibling discount on its own", () => {
    expect(createDiscountName(80, 0)).toBe("$80 Sibling Discount");
  });

  it("names camp credit on its own", () => {
    expect(createDiscountName(0, 250)).toBe("$250 Camp Credit");
  });

  it("joins both with a plus, sibling discount first", () => {
    expect(createDiscountName(160, 250)).toBe(
      "$160 Sibling Discount + $250 Camp Credit"
    );
  });

  it("ignores negative amounts", () => {
    expect(createDiscountName(-80, -1)).toBe("");
  });
});
