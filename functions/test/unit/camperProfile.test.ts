import type {Camper} from "lyf-registration-schemas";

import {
  buildCamperProfilePatch,
  buildCamperProfileUpdate,
  CAMPER_PROFILE_FIELDS,
  didCamperProfileChange,
} from "../../src/families/camperProfile";

const base: Camper = {
  firstName: "Ada",
  lastName: "Lovelace",
  preferredName: "Addie",
  birthDate: "2014-12-10",
  gender: ["Female"],
  pronouns: "she/her",
  isTestData: false,
};

describe("CAMPER_PROFILE_FIELDS", () => {
  it("mirrors only tier-0 profile fields, never health or demographics", () => {
    expect([...CAMPER_PROFILE_FIELDS]).toEqual([
      "firstName",
      "lastName",
      "preferredName",
      "birthDate",
      "gender",
      "pronouns",
    ]);
  });
});

describe("didCamperProfileChange", () => {
  it("is false when nothing changed", () => {
    expect(didCamperProfileChange(base, {...base})).toBe(false);
  });

  it.each([
    ["firstName", "Augusta"],
    ["lastName", "King"],
    ["preferredName", "Ada"],
    ["birthDate", "2014-12-11"],
    ["pronouns", "they/them"],
  ] as const)("is true when %s changes", (field, value) => {
    expect(didCamperProfileChange(base, {...base, [field]: value})).toBe(true);
  });

  it("compares gender by elements", () => {
    expect(didCamperProfileChange(base, {...base, gender: ["Female"]})).toBe(false);
    expect(didCamperProfileChange(base, {...base, gender: ["Non-binary"]})).toBe(true);
    expect(didCamperProfileChange(base, {...base, gender: ["Female", "Other"]})).toBe(true);
    expect(didCamperProfileChange(base, {...base, gender: []})).toBe(true);
  });

  it("treats a missing nullable field and null as the same value", () => {
    const withoutOptional: Camper = {...base};
    delete withoutOptional.preferredName;
    delete withoutOptional.pronouns;

    expect(
      didCamperProfileChange(withoutOptional, {
        ...base,
        preferredName: null,
        pronouns: null,
      })
    ).toBe(false);
  });

  it("ignores fields that are not mirrored", () => {
    const flagged: Camper = {...base, isTestData: true};
    expect(didCamperProfileChange(base, flagged)).toBe(false);
    expect(
      didCamperProfileChange(base, {...base, registrations: []} as Camper)
    ).toBe(false);
  });
});

describe("buildCamperProfilePatch", () => {
  it("builds camperName from first and last name and copies the profile fields", () => {
    expect(buildCamperProfilePatch(base)).toEqual({
      camperName: "Ada Lovelace",
      preferredName: "Addie",
      birthDate: "2014-12-10",
      gender: ["Female"],
      pronouns: "she/her",
    });
  });

  it("normalizes missing values the way createOrUpdateRegistration writes them", () => {
    expect(buildCamperProfilePatch({firstName: "Ada"})).toEqual({
      camperName: "Ada",
      preferredName: null,
      birthDate: "",
      gender: [],
      pronouns: null,
    });
  });

  it("never includes health or demographics fields", () => {
    const patch = buildCamperProfilePatch({
      ...base,
      medicalConditions: "asthma",
      dietAndFoodAllergies: "peanuts",
      demographics: {ethnicity: "x"},
    } as Camper);

    expect(Object.keys(patch).sort()).toEqual(
      ["birthDate", "camperName", "gender", "preferredName", "pronouns"].sort()
    );
  });
});

describe("buildCamperProfileUpdate", () => {
  it("returns null when no mirrored field changed", () => {
    const flagged: Camper = {...base, isTestData: true};
    expect(buildCamperProfileUpdate(base, flagged)).toBeNull();
  });

  it("returns the patch for the new profile when a field changed", () => {
    expect(
      buildCamperProfileUpdate(base, {...base, firstName: "Augusta", pronouns: null})
    ).toEqual({
      camperName: "Augusta Lovelace",
      preferredName: "Addie",
      birthDate: "2014-12-10",
      gender: ["Female"],
      pronouns: null,
    });
  });
});
