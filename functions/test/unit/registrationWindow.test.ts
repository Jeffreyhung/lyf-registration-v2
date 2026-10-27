import {HttpsError} from "firebase-functions/v2/https";
import type {CampYear} from "lyf-registration-schemas";

import {
  assertRegistrationOpen,
  registrationCloseMillis,
} from "../../src/registrationUtils/registrationWindow";
import {FakeFirestore} from "./fakeFirestore";

const CLOSE_MS = Date.UTC(2026, 3, 20, 7, 0, 0); // 2026-04-20 00:00 PDT
const BEFORE = CLOSE_MS - 60_000;
const AFTER = CLOSE_MS + 60_000;

/** Firestore Timestamp stand-in: the check only needs toMillis(). */
const ts = (ms: number) => ({toMillis: () => ms}) as unknown as CampYear["registrationCloseDate"];

const campWithClose: CampYear = {registrationFee: 1325, registrationCloseDate: ts(CLOSE_MS)};
const campWithoutClose: CampYear = {registrationFee: 1325};

async function expectClosed(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe("failed-precondition");
  expect((caught as HttpsError).message).toMatch(/closed on April 19, 2026|closed on April 20, 2026/);
}

describe("registrationCloseMillis", () => {
  it("returns the close date in millis, or null when unset", () => {
    expect(registrationCloseMillis(campWithClose)).toBe(CLOSE_MS);
    expect(registrationCloseMillis(campWithoutClose)).toBeNull();
    expect(registrationCloseMillis(undefined)).toBeNull();
  });
});

describe("assertRegistrationOpen", () => {
  it("allows registration before the close date without any bypass entry", async () => {
    const db = new FakeFirestore();
    await expect(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "parent@example.com", BEFORE)
    ).resolves.toBeUndefined();
  });

  it("allows registration exactly at the close instant", async () => {
    const db = new FakeFirestore();
    await expect(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "parent@example.com", CLOSE_MS)
    ).resolves.toBeUndefined();
  });

  it("does not gate a year that has no close date configured", async () => {
    const db = new FakeFirestore();
    await expect(
      assertRegistrationOpen(db.as(), 2026, campWithoutClose, "parent@example.com", AFTER)
    ).resolves.toBeUndefined();
    await expect(
      assertRegistrationOpen(db.as(), 2026, undefined, "parent@example.com", AFTER)
    ).resolves.toBeUndefined();
  });

  it("rejects registration after the close date when the caller has no bypass entry", async () => {
    const db = new FakeFirestore();
    await expectClosed(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "parent@example.com", AFTER)
    );
  });

  it("allows a caller whose email has a private bypass entry for that year", async () => {
    const db = new FakeFirestore().seed(
      "camps/2026/private/bypass/emails",
      "parent@example.com",
      {email: "parent@example.com", addedBy: "admin@tacl.org"}
    );
    await expect(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "parent@example.com", AFTER)
    ).resolves.toBeUndefined();
  });

  it("matches the bypass entry case- and whitespace-insensitively", async () => {
    const db = new FakeFirestore().seed(
      "camps/2026/private/bypass/emails",
      "parent@example.com",
      {email: "parent@example.com"}
    );
    await expect(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "  Parent@Example.COM ", AFTER)
    ).resolves.toBeUndefined();
  });

  it("does not honour a bypass entry from a different year or a different email", async () => {
    const db = new FakeFirestore()
      .seed("camps/2025/private/bypass/emails", "parent@example.com", {email: "parent@example.com"})
      .seed("camps/2026/private/bypass/emails", "other@example.com", {email: "other@example.com"});
    await expectClosed(
      assertRegistrationOpen(db.as(), 2026, campWithClose, "parent@example.com", AFTER)
    );
  });

  it("ignores a legacy registrationBypassEmails field on the camp document", async () => {
    const db = new FakeFirestore();
    const legacy = {
      ...campWithClose,
      registrationBypassEmails: ["parent@example.com"],
    } as CampYear;
    await expectClosed(
      assertRegistrationOpen(db.as(), 2026, legacy, "parent@example.com", AFTER)
    );
  });
});
