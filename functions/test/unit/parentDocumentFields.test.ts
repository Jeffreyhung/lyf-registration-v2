import {parentDocumentFields} from "../../src/registration/parentDocumentFields";

describe("parentDocumentFields", () => {
  it("drops fields the client left out instead of writing undefined", () => {
    const fields = parentDocumentFields({
      email: "Ada@Example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "555-0100",
      subscribeToMailingList: true,
    });

    expect(fields).toEqual({
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "555-0100",
      subscribeToMailingList: true,
    });
    expect(Object.keys(fields)).not.toContain("lineId");
    expect(Object.values(fields)).not.toContain(undefined);
  });

  it("keeps explicit empty and false values", () => {
    const fields = parentDocumentFields({
      email: "ada@example.com",
      lineId: "",
      subscribeToMailingList: false,
    });

    expect(fields).toEqual({
      email: "ada@example.com",
      lineId: "",
      subscribeToMailingList: false,
    });
  });

  it("ignores fields that are not stored on the parent document", () => {
    const fields = parentDocumentFields({
      email: "ada@example.com",
      stripeCustomerId: "cus_123",
    });

    expect(fields).toEqual({email: "ada@example.com"});
  });
});
