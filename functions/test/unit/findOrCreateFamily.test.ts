import type {Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {findOrCreateFamily} from "../../src/registrationUtils/findOrCreateDocument";
import {FakeFirestore} from "./fakeFirestore";

const attacker = "attacker@example.com";
const victim = "victim@example.com";
const spouse = "spouse@example.com";

function firestore(fake: FakeFirestore): Firestore {
  return fake as unknown as Firestore;
}

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
}

describe("findOrCreateFamily", () => {
  it("creates a new family for a caller with no family", async () => {
    const db = new FakeFirestore();

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(false);
    expect(result.ref.path).toMatch(/^families\//);
  });

  it("does not put a victim into a family where an attacker merely listed them", async () => {
    const db = new FakeFirestore().seed("families", "attackers", {
      emails: [attacker, victim],
      createdBy: attacker,
      confirmedEmails: [attacker],
    });

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(false);
    expect(result.ref.id).not.toBe("attackers");
  });

  it("still gives the victim a new family when the attacker also listed their spouse", async () => {
    const db = new FakeFirestore().seed("families", "attackers", {
      emails: [attacker, victim, spouse],
      createdBy: attacker,
      confirmedEmails: [attacker],
    });

    const forVictim = await findOrCreateFamily(firestore(db), victim);
    const forSpouse = await findOrCreateFamily(firestore(db), spouse);

    expect(forVictim.didExist).toBe(false);
    expect(forVictim.ref.id).not.toBe("attackers");
    expect(forSpouse.didExist).toBe(false);
    expect(forSpouse.ref.id).not.toBe("attackers");
  });

  it("does not lock a victim out of their own family because an attacker listed them", async () => {
    const db = new FakeFirestore()
      .seed("families", "attackers", {
        emails: [attacker, victim],
        createdBy: attacker,
        confirmedEmails: [attacker],
      })
      .seed("families", "victims", {
        emails: [victim],
        createdBy: victim,
        confirmedEmails: [victim],
      });

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(true);
    expect(result.ref.id).toBe("victims");
  });

  it("prefers the caller's own family over a forged joinFamilyId", async () => {
    const db = new FakeFirestore()
      .seed("families", "attackers", {
        emails: [attacker, victim],
        createdBy: attacker,
      })
      .seed("families", "victims", {emails: [victim], createdBy: victim});

    const result = await findOrCreateFamily(
      firestore(db),
      victim,
      "attackers"
    );

    expect(result.ref.id).toBe("victims");
  });

  it("rejects a joinFamilyId for a family the caller is not listed in", async () => {
    const db = new FakeFirestore().seed("families", "someone-elses", {
      emails: [attacker],
      createdBy: attacker,
    });

    await expectHttpsError(
      findOrCreateFamily(firestore(db), victim, "someone-elses"),
      "permission-denied"
    );
  });

  it("rejects a joinFamilyId for a family that does not exist", async () => {
    const db = new FakeFirestore();

    await expectHttpsError(
      findOrCreateFamily(firestore(db), victim, "no-such-family"),
      "permission-denied"
    );
  });

  it("rejects a joinFamilyId for a different family than the one the caller is listed in", async () => {
    const db = new FakeFirestore()
      .seed("families", "listed-in", {emails: [attacker, victim], createdBy: attacker})
      .seed("families", "target", {emails: [spouse], createdBy: spouse});

    await expectHttpsError(
      findOrCreateFamily(firestore(db), victim, "target"),
      "permission-denied"
    );
  });

  it("joins a legitimate co-parent into the family they confirmed", async () => {
    const db = new FakeFirestore().seed("families", "household", {
      emails: [attacker, victim],
      createdBy: attacker,
      confirmedEmails: [attacker],
    });

    const result = await findOrCreateFamily(firestore(db), victim, "household");

    expect(result.didExist).toBe(true);
    expect(result.ref.id).toBe("household");
  });

  it("no longer needs joinFamilyId once the co-parent has confirmed", async () => {
    const db = new FakeFirestore().seed("families", "household", {
      emails: [attacker, victim],
      createdBy: attacker,
      confirmedEmails: [attacker, victim],
    });

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(true);
    expect(result.ref.id).toBe("household");
  });

  it("auto-adopts a legacy family whose only member is the caller", async () => {
    const db = new FakeFirestore().seed("families", "legacy", {
      emails: [victim],
    });

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(true);
    expect(result.ref.id).toBe("legacy");
  });

  it("does not auto-adopt a legacy family with several members", async () => {
    const db = new FakeFirestore().seed("families", "legacy", {
      emails: [victim, spouse],
    });

    const result = await findOrCreateFamily(firestore(db), victim);

    expect(result.didExist).toBe(false);
    expect(result.ref.id).not.toBe("legacy");
  });

  it("still throws when the caller owns two families", async () => {
    const db = new FakeFirestore()
      .seed("families", "first", {emails: [victim], createdBy: victim})
      .seed("families", "second", {emails: [victim], createdBy: victim});

    await expectHttpsError(
      findOrCreateFamily(firestore(db), victim),
      "failed-precondition"
    );
  });

  it("looks the caller up by normalized email", async () => {
    const db = new FakeFirestore().seed("families", "victims", {
      emails: [victim],
      createdBy: victim,
    });

    const result = await findOrCreateFamily(
      firestore(db),
      "  Victim@Example.COM "
    );

    expect(result.ref.id).toBe("victims");
  });
});
