import {isEstablishedFamilyMember, type Family} from "lyf-registration-schemas";

const creator = "creator@example.com";
const coParent = "coparent@example.com";
const stranger = "stranger@example.com";

describe("isEstablishedFamilyMember", () => {
  it("accepts the creator of the family", () => {
    const family: Family = {
      emails: [creator, coParent],
      createdBy: creator,
      confirmedEmails: [creator],
    };
    expect(isEstablishedFamilyMember(family, creator)).toBe(true);
  });

  it("accepts a member who previously confirmed the family", () => {
    const family: Family = {
      emails: [creator, coParent],
      createdBy: creator,
      confirmedEmails: [creator, coParent],
    };
    expect(isEstablishedFamilyMember(family, coParent)).toBe(true);
  });

  it("accepts the sole member of a family", () => {
    const family: Family = {emails: [creator], createdBy: creator};
    expect(isEstablishedFamilyMember(family, creator)).toBe(true);
  });

  it("rejects someone who was merely listed by the creator", () => {
    const family: Family = {
      emails: [creator, coParent],
      createdBy: creator,
      confirmedEmails: [creator],
    };
    expect(isEstablishedFamilyMember(family, coParent)).toBe(false);
  });

  it("rejects someone who is not in the family at all", () => {
    const family: Family = {emails: [creator], createdBy: creator};
    expect(isEstablishedFamilyMember(family, stranger)).toBe(false);
  });

  it("rejects a listed-only member when confirmedEmails is missing entirely", () => {
    const family: Family = {emails: [creator, coParent], createdBy: creator};
    expect(isEstablishedFamilyMember(family, coParent)).toBe(false);
  });

  describe("legacy families without createdBy", () => {
    it("adopts the sole listed member", () => {
      const family: Family = {emails: [creator]};
      expect(isEstablishedFamilyMember(family, creator)).toBe(true);
    });

    it("adopts nobody when several emails are listed", () => {
      const family: Family = {emails: [creator, coParent]};
      expect(isEstablishedFamilyMember(family, creator)).toBe(false);
      expect(isEstablishedFamilyMember(family, coParent)).toBe(false);
    });

    it("still honours confirmedEmails", () => {
      const family: Family = {
        emails: [creator, coParent],
        confirmedEmails: [coParent],
      };
      expect(isEstablishedFamilyMember(family, coParent)).toBe(true);
      expect(isEstablishedFamilyMember(family, creator)).toBe(false);
    });
  });

  describe("email normalization", () => {
    it("matches createdBy regardless of case and surrounding whitespace", () => {
      const family: Family = {
        emails: [creator, coParent],
        createdBy: "Creator@Example.COM",
      };
      expect(isEstablishedFamilyMember(family, "  CREATOR@example.com ")).toBe(
        true
      );
    });

    it("matches confirmedEmails regardless of case", () => {
      const family: Family = {
        emails: [creator, coParent],
        createdBy: creator,
        confirmedEmails: ["CoParent@Example.com"],
      };
      expect(isEstablishedFamilyMember(family, coParent)).toBe(true);
    });

    it("treats differently-cased duplicates of the same address as one member", () => {
      const family: Family = {emails: ["Creator@Example.com", creator]};
      expect(isEstablishedFamilyMember(family, creator)).toBe(true);
    });

    it("does not let case differences hide another member", () => {
      const family: Family = {emails: [creator, "CoParent@Example.com"]};
      expect(isEstablishedFamilyMember(family, creator)).toBe(false);
    });
  });
});
