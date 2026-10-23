import type {Camper, CampYear, Family, Registration} from "lyf-registration-schemas";

import {
  findOrCreateCamper,
  findOrCreateParent,
  findOrCreateRegistration,
} from "../../src/registrationUtils/findOrCreateDocument";
import {FakeFirestore} from "./fakeFirestore";

// findOrCreateFamily has its own suite in findOrCreateFamily.test.ts.

describe("findOrCreateParent", () => {
  const db = new FakeFirestore();
  const familyRef = db.collection("families").doc("fam").as<Family>();

  it("keys the parent document by lowercased email", async () => {
    const ref = await findOrCreateParent(familyRef, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "Ada@Example.COM",
    });

    expect(ref.path).toBe("families/fam/parents/ada@example.com");
  });

  it("falls back to the phone number when there is no email", async () => {
    const ref = await findOrCreateParent(familyRef, {
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "+15555550123",
    });

    expect(ref.path).toBe("families/fam/parents/+15555550123");
  });

  it("prefers the email when both are present", async () => {
    const ref = await findOrCreateParent(familyRef, {
      email: "ada@example.com",
      phoneNumber: "+15555550123",
    });

    expect(ref.id).toBe("ada@example.com");
  });

  it("throws when there is neither an email nor a phone number", async () => {
    await expect(
      findOrCreateParent(familyRef, {firstName: "Ada", lastName: "Lovelace"})
    ).rejects.toThrow(/No email or phone number found on the parent Ada Lovelace/);
  });
});

describe("findOrCreateCamper", () => {
  const CAMPERS = "families/fam/campers";

  it("uses the provided id without looking anything up", async () => {
    const db = new FakeFirestore();
    const familyRef = db.collection("families").doc("fam").as<Family>();

    const ref = await findOrCreateCamper(familyRef, {id: "c1", firstName: "Ada"});

    expect(ref.path).toBe("families/fam/campers/c1");
  });

  it("matches an existing camper in the family by first name", async () => {
    const db = new FakeFirestore()
      .seed(CAMPERS, "c1", {firstName: "Ada"})
      .seed(CAMPERS, "c2", {firstName: "Grace"});
    const familyRef = db.collection("families").doc("fam").as<Family>();

    const ref = await findOrCreateCamper(familyRef, {firstName: "Grace"});

    expect(ref.id).toBe("c2");
  });

  it("does not match a camper with the same name in another family", async () => {
    const db = new FakeFirestore().seed("families/other/campers", "c1", {
      firstName: "Ada",
    });
    const familyRef = db.collection("families").doc("fam").as<Family>();

    const ref = await findOrCreateCamper(familyRef, {firstName: "Ada"});

    expect(ref.path).toMatch(/^families\/fam\/campers\/generated-/);
  });

  it("creates a new camper when there is no match", async () => {
    const db = new FakeFirestore().seed(CAMPERS, "c1", {firstName: "Ada"});
    const familyRef = db.collection("families").doc("fam").as<Family>();

    const ref = await findOrCreateCamper(familyRef, {firstName: "Grace"});

    expect(ref.path).toMatch(/^families\/fam\/campers\/generated-/);
  });

  it("creates a new camper rather than guessing between duplicate names", async () => {
    const db = new FakeFirestore()
      .seed(CAMPERS, "c1", {firstName: "Ada", lastName: "A"})
      .seed(CAMPERS, "c2", {firstName: "Ada", lastName: "B"});
    const familyRef = db.collection("families").doc("fam").as<Family>();

    const ref = await findOrCreateCamper(familyRef, {firstName: "Ada"});

    expect(["c1", "c2"]).not.toContain(ref.id);
  });
});

describe("findOrCreateRegistration", () => {
  const CAMPERS = "families/fam/campers";

  function setup() {
    const db = new FakeFirestore();
    const campRef = db.collection("camps").doc("2026").as<CampYear>();
    const camperRef = db.collection(CAMPERS).doc("c1").as<Camper>();
    return {db, campRef, camperRef};
  }

  it("returns the camper's existing registration for this camp year", async () => {
    const {db, campRef, camperRef} = setup();
    const existing = db.doc("camps/2026/registrations/r1");
    db.seed(CAMPERS, "c1", {
      registrations: [db.doc("camps/2025/registrations/r0"), existing],
    });

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(true);
    expect(result.ref.path).toBe(existing.path);
  });

  it("creates a registration when the camper only has ones from other years", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {
      registrations: [db.doc("camps/2025/registrations/r0")],
    });

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(false);
    expect(result.ref.path).toMatch(/^camps\/2026\/registrations\/generated-/);
  });

  it("creates a registration when the camper has none at all", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {firstName: "Ada"});

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(false);
    expect(result.ref.path).toMatch(/^camps\/2026\/registrations\//);
  });

  it("writes timestamps and copies the camper's test-data flag onto a new registration", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {isTestData: true});

    const {ref} = await findOrCreateRegistration(camperRef, campRef);
    const written = db.read("camps/2026/registrations", ref.id) as Registration;

    expect(written.isTestData).toBe(true);
    expect(written.createdAt).toBeDefined();
    expect(written.updatedAt).toBeDefined();
  });

  it("defaults a new registration to production data", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {});

    const {ref} = await findOrCreateRegistration(camperRef, campRef);

    expect(
      (db.read("camps/2026/registrations", ref.id) as Registration).isTestData
    ).toBe(false);
  });
});
