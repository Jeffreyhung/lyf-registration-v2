import type {Camper, CampYear, Family, Registration} from "lyf-registration-schemas";

import {
  findOrCreateCamper,
  findOrCreateParent,
  findOrCreateRegistration,
} from "../../src/registrationUtils/findOrCreateDocument";
import {FakeDocRef, FakeFirestore} from "./fakeFirestore";

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

  it("treats a blank email like a missing one", async () => {
    const ref = await findOrCreateParent(familyRef, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "",
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
  const REGISTRATIONS = "camps/2026/registrations";

  function setup() {
    const db = new FakeFirestore();
    const campRef = db.collection("camps").doc("2026").as<CampYear>();
    const camperRef = db.collection(CAMPERS).doc("c1").as<Camper>();
    return {db, campRef, camperRef};
  }

  it("returns the camper's existing (legacy, random-id) registration for this camp year", async () => {
    const {db, campRef, camperRef} = setup();
    const existing = db.doc("camps/2026/registrations/r1");
    db.seed(CAMPERS, "c1", {
      registrations: [db.doc("camps/2025/registrations/r0"), existing],
    });

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(true);
    expect(result.ref.path).toBe(existing.path);
  });

  it("prefers the legacy ref in the registrations array over the deterministic doc", async () => {
    const {db, campRef, camperRef} = setup();
    const legacy = db.doc("camps/2026/registrations/r1");
    db.seed(CAMPERS, "c1", {registrations: [legacy]});
    db.seed(REGISTRATIONS, "c1", {status: "Waitlist"});

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(true);
    expect(result.ref.path).toBe(legacy.path);
  });

  it("returns the deterministic doc when it exists but is not linked from the camper yet", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {registrations: []});
    db.seed(REGISTRATIONS, "c1", {status: "Pending Payment", isTestData: false});

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(true);
    expect(result.ref.path).toBe("camps/2026/registrations/c1");
    // Nothing was overwritten by the lookup.
    expect(db.read(REGISTRATIONS, "c1")).toEqual({
      status: "Pending Payment",
      isTestData: false,
    });
  });

  it("creates the registration at the camper's id when the camper only has ones from other years", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {
      registrations: [db.doc("camps/2025/registrations/r0")],
    });

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(false);
    expect(result.ref.path).toBe("camps/2026/registrations/c1");
    expect(db.read(REGISTRATIONS, "c1")).toBeDefined();
  });

  it("creates the registration at the camper's id when the camper has none at all", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {firstName: "Ada"});

    const result = await findOrCreateRegistration(camperRef, campRef);

    expect(result.didExist).toBe(false);
    expect(result.ref.path).toBe("camps/2026/registrations/c1");
  });

  it("gives two campers in the same camp distinct, deterministic ids", async () => {
    const {db, campRef, camperRef} = setup();
    const siblingRef = db.collection(CAMPERS).doc("c2").as<Camper>();
    db.seed(CAMPERS, "c1", {}).seed(CAMPERS, "c2", {});

    const first = await findOrCreateRegistration(camperRef, campRef);
    const second = await findOrCreateRegistration(siblingRef, campRef);

    expect(first.ref.path).toBe("camps/2026/registrations/c1");
    expect(second.ref.path).toBe("camps/2026/registrations/c2");
  });

  it("is idempotent: a second call for the same camper finds, not recreates", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {isTestData: true});

    const first = await findOrCreateRegistration(camperRef, campRef);
    await first.ref.set({status: "Waitlist"} as Registration, {merge: true});
    const second = await findOrCreateRegistration(camperRef, campRef);

    expect(second.didExist).toBe(true);
    expect(second.ref.path).toBe(first.ref.path);
    expect((db.read(REGISTRATIONS, "c1") as Registration).status).toBe("Waitlist");
  });

  it("reuses the doc when a concurrent request created it between the lookup and create()", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {});
    const regRef = db.doc("camps/2026/registrations/c1");
    // Simulate the race: the other request's doc lands right before our
    // create(), which then fails with ALREADY_EXISTS like the real SDK.
    const realCreate = FakeDocRef.prototype.create;
    const createSpy = jest
      .spyOn(FakeDocRef.prototype, "create")
      .mockImplementation(async function (this: FakeDocRef, data) {
        await regRef.set({status: "Pending Payment"});
        return realCreate.call(this, data);
      });

    try {
      const result = await findOrCreateRegistration(camperRef, campRef);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.didExist).toBe(true);
      expect(result.ref.path).toBe(regRef.path);
      // The winner's document was not clobbered.
      expect((await regRef.get()).data()).toEqual({status: "Pending Payment"});
    } finally {
      createSpy.mockRestore();
    }
  });

  it("rethrows create() failures other than ALREADY_EXISTS", async () => {
    const {db, campRef, camperRef} = setup();
    db.seed(CAMPERS, "c1", {});
    const createSpy = jest
      .spyOn(FakeDocRef.prototype, "create")
      .mockRejectedValue(Object.assign(new Error("unavailable"), {code: 14}));

    try {
      await expect(findOrCreateRegistration(camperRef, campRef)).rejects.toThrow(
        /unavailable/
      );
    } finally {
      createSpy.mockRestore();
    }
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
