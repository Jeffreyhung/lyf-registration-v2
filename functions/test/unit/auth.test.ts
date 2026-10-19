import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";

// ../utils opens Firestore and Stripe clients at import time, so replace it
// with a stub whose `admins` collection is backed by this map. Only names
// prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockAdmins = new Map<string, Record<string, unknown>>();
jest.mock("../../src/utils", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === "admins" ? mockAdmins.get(id) : undefined;
          return {exists: data !== undefined, data: () => data};
        },
      }),
    }),
  },
}));

import {
  MAX_CAMPERS_PER_REGISTRATION,
  MAX_PARENTS_PER_REGISTRATION,
  resolveForceWaitlistFlag,
  validateRegistrationPayloadShape,
} from "../../src/utils/auth";

function requestFrom(email: string | null): CallableRequest {
  return {
    data: {},
    rawRequest: {},
    auth: email ?
      {uid: "uid-" + email, token: {email}} :
      undefined,
  } as unknown as CallableRequest;
}

function expectHttpsError(fn: () => void, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
}

const parent = {email: "parent@example.com", firstName: "P", lastName: "Q"};
const camper = {firstName: "C", lastName: "Q", grade: 5};
const demographics = {born: "US"};

describe("validateRegistrationPayloadShape", () => {
  it("accepts a well-formed payload", () => {
    expect(() =>
      validateRegistrationPayloadShape({
        parents: [parent],
        campers: [camper, camper],
        demographics: [demographics, demographics],
      })
    ).not.toThrow();
  });

  it("accepts payloads exactly at the limits", () => {
    expect(() =>
      validateRegistrationPayloadShape({
        parents: Array(MAX_PARENTS_PER_REGISTRATION).fill(parent),
        campers: Array(MAX_CAMPERS_PER_REGISTRATION).fill(camper),
        demographics: Array(MAX_CAMPERS_PER_REGISTRATION).fill(demographics),
      })
    ).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["not an array", {email: "x"}],
    ["empty", []],
  ])("rejects parents that are %s", (_label, parents) => {
    expectHttpsError(
      () =>
        validateRegistrationPayloadShape({
          parents,
          campers: [camper],
          demographics: [demographics],
        }),
      "invalid-argument"
    );
  });

  it("rejects more parents than the limit", () => {
    expectHttpsError(
      () =>
        validateRegistrationPayloadShape({
          parents: Array(MAX_PARENTS_PER_REGISTRATION + 1).fill(parent),
          campers: [camper],
          demographics: [demographics],
        }),
      "invalid-argument"
    );
  });

  it.each([
    ["missing", undefined],
    ["not an array", "camper"],
    ["empty", []],
  ])("rejects campers that are %s", (_label, campers) => {
    expectHttpsError(
      () =>
        validateRegistrationPayloadShape({
          parents: [parent],
          campers,
          demographics: [],
        }),
      "invalid-argument"
    );
  });

  it("rejects more campers than the limit", () => {
    const n = MAX_CAMPERS_PER_REGISTRATION + 1;
    expectHttpsError(
      () =>
        validateRegistrationPayloadShape({
          parents: [parent],
          campers: Array(n).fill(camper),
          demographics: Array(n).fill(demographics),
        }),
      "invalid-argument"
    );
  });

  it.each([
    ["missing", undefined],
    ["not an array", demographics],
    ["shorter than campers", [demographics]],
    ["longer than campers", [demographics, demographics, demographics]],
  ])("rejects demographics that are %s", (_label, demo) => {
    expectHttpsError(
      () =>
        validateRegistrationPayloadShape({
          parents: [parent],
          campers: [camper, camper],
          demographics: demo,
        }),
      "invalid-argument"
    );
  });
});

describe("resolveForceWaitlistFlag", () => {
  beforeEach(() => mockAdmins.clear());

  it("is false when the client did not ask for it, whoever they are", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      resolveForceWaitlistFlag(requestFrom("admin@tacl.org"), false)
    ).resolves.toBe(false);
    await expect(
      resolveForceWaitlistFlag(requestFrom("parent@example.com"), false)
    ).resolves.toBe(false);
  });

  it("ignores forceWaitlist from a non-admin", async () => {
    await expect(
      resolveForceWaitlistFlag(requestFrom("parent@example.com"), true)
    ).resolves.toBe(false);
  });

  it("ignores forceWaitlist from an unauthenticated request", async () => {
    await expect(
      resolveForceWaitlistFlag(requestFrom(null), true)
    ).resolves.toBe(false);
  });

  it("ignores forceWaitlist from a disabled admin", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin", disabled: true});
    await expect(
      resolveForceWaitlistFlag(requestFrom("admin@tacl.org"), true)
    ).resolves.toBe(false);
  });

  it("ignores forceWaitlist from an admin role without createTestData", async () => {
    mockAdmins.set("staff@tacl.org", {role: "program_staff"});
    await expect(
      resolveForceWaitlistFlag(requestFrom("staff@tacl.org"), true)
    ).resolves.toBe(false);
  });

  it("ignores forceWaitlist from an admin doc with an unknown role", async () => {
    mockAdmins.set("admin@tacl.org", {role: "superuser"});
    await expect(
      resolveForceWaitlistFlag(requestFrom("admin@tacl.org"), true)
    ).resolves.toBe(false);
  });

  it("honours forceWaitlist from a full admin", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      resolveForceWaitlistFlag(requestFrom("admin@tacl.org"), true)
    ).resolves.toBe(true);
  });

  it("looks the admin up by normalized email", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      resolveForceWaitlistFlag(requestFrom("  Admin@TACL.org "), true)
    ).resolves.toBe(true);
  });
});
