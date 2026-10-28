import {buildParentContacts} from "../../src/registrationUtils/buildParentContacts";

describe("buildParentContacts", () => {
  it("copies the contact fields in payload order (signed-in parent first)", () => {
    expect(
      buildParentContacts([
        {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phoneNumber: "+15555550100",
          lineId: "ada",
          subscribeToMailingList: true,
        },
        {
          firstName: "Charles",
          lastName: "Babbage",
          email: "charles@example.com",
          phoneNumber: "+15555550101",
        },
      ])
    ).toEqual([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phoneNumber: "+15555550100",
      },
      {
        firstName: "Charles",
        lastName: "Babbage",
        email: "charles@example.com",
        phoneNumber: "+15555550101",
      },
    ]);
  });

  it("normalizes emails like familyEmails does", () => {
    expect(buildParentContacts([{email: "  Ada@Example.COM "}])[0].email).toBe(
      "ada@example.com"
    );
  });

  it("writes empty strings for missing fields rather than omitting them", () => {
    expect(buildParentContacts([{firstName: "Ada"}])).toEqual([
      {firstName: "Ada", lastName: "", email: "", phoneNumber: ""},
    ]);
  });

  it("collapses duplicate emails onto the first occurrence", () => {
    const contacts = buildParentContacts([
      {firstName: "Ada", email: "ada@example.com"},
      {firstName: "Ada again", email: "ADA@example.com"},
      {firstName: "Charles", email: "charles@example.com"},
    ]);

    expect(contacts.map((c) => c.firstName)).toEqual(["Ada", "Charles"]);
  });

  it("keeps parents that have no email", () => {
    const contacts = buildParentContacts([
      {firstName: "Ada", email: "ada@example.com"},
      {firstName: "Charles", phoneNumber: "+15555550101"},
      {firstName: "Grace", phoneNumber: "+15555550102"},
    ]);

    expect(contacts.map((c) => c.firstName)).toEqual(["Ada", "Charles", "Grace"]);
  });

  it("returns an empty list for no parents", () => {
    expect(buildParentContacts([])).toEqual([]);
  });
});
