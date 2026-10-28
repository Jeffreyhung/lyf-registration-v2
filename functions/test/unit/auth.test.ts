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
  adminCallableOptions,
  assertAdmin,
  assertCallerEmailInList,
  callableOptions,
  MAX_CAMPERS_PER_REGISTRATION,
  MAX_PARENTS_PER_REGISTRATION,
  resolveForceWaitlistFlag,
  resolveTestDataFlag,
  validateDollarAmount,
  validateRedirectUrl,
  validateRegistrationPayloadShape,
} from "../../src/utils/auth";

/**
 * null  -> no auth at all (anonymous call)
 * undefined -> signed in, but the token carries no email
 */
function requestFrom(email: string | null | undefined): CallableRequest {
  return {
    data: {},
    rawRequest: {},
    auth: email === null ? undefined : {uid: "uid", token: {email}},
  } as unknown as CallableRequest;
}

function expectHttpsError(fn: () => unknown, code: string, message?: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
  if (message) expect((caught as HttpsError).message).toMatch(message);
}

async function expectAsyncHttpsError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp
) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
  if (message) expect((caught as HttpsError).message).toMatch(message);
}

beforeEach(() => mockAdmins.clear());

describe("callableOptions", () => {
  it("makes callables publicly invokable with CORS so auth is checked in-function", () => {
    expect(callableOptions).toEqual({cors: true, invoker: "public"});
  });
});

describe("adminCallableOptions", () => {
  it("keeps the public invoker but limits CORS to the site origins", () => {
    expect(adminCallableOptions.invoker).toBe("public");
    expect(adminCallableOptions.cors).toEqual(["https://lyf-registration.tacl.org"]);
    expect(adminCallableOptions.cors).not.toContain("http://localhost:8000");
  });
});

describe("validateRedirectUrl", () => {
  it("accepts the production origin with any path and query", () => {
    expect(() =>
      validateRedirectUrl("https://lyf-registration.tacl.org/registration?x=1")
    ).not.toThrow();
    expect(() =>
      validateRedirectUrl("https://lyf-registration.tacl.org")
    ).not.toThrow();
  });

  it.each([
    ["another host", "https://evil.example.com/registration"],
    ["a look-alike subdomain", "https://lyf-registration.tacl.org.evil.com/"],
    ["the right host over plain http", "http://lyf-registration.tacl.org/"],
    ["the right host on another port", "https://lyf-registration.tacl.org:8443/"],
    ["localhost outside the emulator", "http://localhost:8000/registration"],
    ["userinfo smuggling", "https://lyf-registration.tacl.org@evil.com/"],
  ])("rejects %s", (_label, url) => {
    expectHttpsError(
      () => validateRedirectUrl(url),
      "invalid-argument",
      /not allowed/
    );
  });

  it.each([
    ["an empty string", ""],
    ["a relative path", "/registration"],
    ["garbage", "not a url"],
  ])("rejects %s as an invalid URL", (_label, url) => {
    expectHttpsError(
      () => validateRedirectUrl(url),
      "invalid-argument",
      /Invalid redirect URL/
    );
  });

  describe("configured through the environment", () => {
    const original = {...process.env};

    afterEach(() => {
      process.env = {...original};
    });

    // The allow-list is computed once at import, so re-import with the env set.
    function loadWithEnv(env: Record<string, string>) {
      process.env = {...original, ...env};
      let mod: typeof import("../../src/utils/auth");
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require("../../src/utils/auth");
      });
      return mod!;
    }

    // The isolated module gets its own copy of firebase-functions, so
    // instanceof against this file's HttpsError would fail; check the shape.
    function expectIsolatedHttpsError(fn: () => unknown, code: string) {
      let caught: unknown;
      try {
        fn();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).constructor.name).toBe("HttpsError");
      expect((caught as HttpsError).code).toBe(code);
    }

    it("accepts every origin listed in ALLOWED_REDIRECT_ORIGINS and nothing else", () => {
      const {validateRedirectUrl: validate} = loadWithEnv({
        ALLOWED_REDIRECT_ORIGINS:
          "https://staging.example.com, https://preview.example.com ,",
      });

      expect(() => validate("https://staging.example.com/x")).not.toThrow();
      expect(() => validate("https://preview.example.com/x")).not.toThrow();
      expectIsolatedHttpsError(
        () => validate("https://lyf-registration.tacl.org/x"),
        "invalid-argument"
      );
    });

    it("admin callables' CORS follows ALLOWED_REDIRECT_ORIGINS and the emulator flag", () => {
      const configured = loadWithEnv({
        ALLOWED_REDIRECT_ORIGINS: "https://staging.example.com, https://lyf.example.org",
      });
      expect(configured.adminCallableOptions.cors).toEqual([
        "https://staging.example.com",
        "https://lyf.example.org",
      ]);
      expect(configured.callableOptions.cors).toBe(true);

      const emulated = loadWithEnv({FUNCTIONS_EMULATOR: "true"});
      expect(emulated.adminCallableOptions.cors).toEqual([
        "https://lyf-registration.tacl.org",
        "http://localhost:8000",
        "http://localhost:9000",
      ]);
    });

    it("only allows localhost when running in the Firebase emulator", () => {
      const {validateRedirectUrl: validate} = loadWithEnv({
        FUNCTIONS_EMULATOR: "true",
      });

      expect(() => validate("http://localhost:8000/registration")).not.toThrow();
      expect(() => validate("http://localhost:9000/")).not.toThrow();
      expect(() => validate("https://lyf-registration.tacl.org/")).not.toThrow();
      expectIsolatedHttpsError(
        () => validate("http://localhost:3000/"),
        "invalid-argument"
      );
    });
  });
});

describe("assertCallerEmailInList", () => {
  it("passes when the caller is one of the listed parents", () => {
    expect(() =>
      assertCallerEmailInList("parent@example.com", [
        "other@example.com",
        "parent@example.com",
      ])
    ).not.toThrow();
  });

  it("compares emails after normalization", () => {
    expect(() =>
      assertCallerEmailInList("  Parent@Example.COM ", ["parent@example.com"])
    ).not.toThrow();
    expect(() =>
      assertCallerEmailInList("parent@example.com", ["PARENT@example.com "])
    ).not.toThrow();
  });

  it("rejects a caller who is not listed", () => {
    expectHttpsError(
      () => assertCallerEmailInList("parent@example.com", ["other@example.com"]),
      "permission-denied"
    );
  });

  it("rejects when the list is empty", () => {
    expectHttpsError(
      () => assertCallerEmailInList("parent@example.com", []),
      "permission-denied"
    );
  });
});

describe("validateDollarAmount", () => {
  it.each([1, 50, 1_000_000])("accepts %i", (amount) => {
    expect(() => validateDollarAmount(amount, "amount")).not.toThrow();
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["fractional", 10.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["above the default maximum", 1_000_001],
    ["a numeric string", "50" as unknown as number],
    ["undefined", undefined as unknown as number],
  ])("rejects %s", (_label, amount) => {
    expectHttpsError(
      () => validateDollarAmount(amount, "donation"),
      "invalid-argument",
      /donation must be a positive integer up to 1000000/
    );
  });

  it("honours a custom maximum", () => {
    expect(() => validateDollarAmount(500, "refund", 500)).not.toThrow();
    expectHttpsError(
      () => validateDollarAmount(501, "refund", 500),
      "invalid-argument",
      /up to 500/
    );
  });
});

describe("assertAdmin", () => {
  it("rejects an unauthenticated request", async () => {
    await expectAsyncHttpsError(
      assertAdmin(requestFrom(null), "manageAdmins"),
      "unauthenticated"
    );
  });

  it("rejects a token without an email", async () => {
    await expectAsyncHttpsError(
      assertAdmin(requestFrom(undefined), "manageAdmins"),
      "unauthenticated"
    );
  });

  it("rejects a signed-in user who is not an admin", async () => {
    await expectAsyncHttpsError(
      assertAdmin(requestFrom("parent@example.com"), "writeRegistrations"),
      "permission-denied"
    );
  });

  it("rejects a disabled admin", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin", disabled: true});
    await expectAsyncHttpsError(
      assertAdmin(requestFrom("admin@tacl.org"), "writeRegistrations"),
      "permission-denied"
    );
  });

  it("rejects an admin doc with an unknown or missing role", async () => {
    mockAdmins.set("admin@tacl.org", {role: "superuser"});
    await expectAsyncHttpsError(
      assertAdmin(requestFrom("admin@tacl.org"), "writeRegistrations"),
      "permission-denied"
    );

    mockAdmins.set("legacy@tacl.org", {});
    await expectAsyncHttpsError(
      assertAdmin(requestFrom("legacy@tacl.org"), "writeRegistrations"),
      "permission-denied"
    );
  });

  it("rejects a role that lacks the capability and names the roles that have it", async () => {
    mockAdmins.set("staff@tacl.org", {role: "program_staff"});
    await expectAsyncHttpsError(
      assertAdmin(requestFrom("staff@tacl.org"), "readHealth"),
      "permission-denied",
      /requires one of: full_admin, health_staff/
    );
  });

  it("returns the caller's email and role when the capability is granted", async () => {
    mockAdmins.set("staff@tacl.org", {role: "program_staff"});
    await expect(
      assertAdmin(requestFrom("staff@tacl.org"), "writeRegistrations")
    ).resolves.toEqual({email: "staff@tacl.org", role: "program_staff"});
  });

  it("looks the admin up by normalized email", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      assertAdmin(requestFrom("  Admin@TACL.org "), "manageAdmins")
    ).resolves.toMatchObject({role: "full_admin"});
  });
});

describe("resolveTestDataFlag", () => {
  it("is false when the client did not ask for test data, whoever they are", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      resolveTestDataFlag(requestFrom("admin@tacl.org"), false)
    ).resolves.toBe(false);
    await expect(
      resolveTestDataFlag(requestFrom("parent@example.com"), false)
    ).resolves.toBe(false);
  });

  it("silently forces production mode for an unauthenticated request", async () => {
    await expect(resolveTestDataFlag(requestFrom(null), true)).resolves.toBe(
      false
    );
    await expect(
      resolveTestDataFlag(requestFrom(undefined), true)
    ).resolves.toBe(false);
  });

  it("silently forces production mode for a non-admin", async () => {
    await expect(
      resolveTestDataFlag(requestFrom("parent@example.com"), true)
    ).resolves.toBe(false);
  });

  it("silently forces production mode for a role without createTestData", async () => {
    mockAdmins.set("staff@tacl.org", {role: "program_staff"});
    await expect(
      resolveTestDataFlag(requestFrom("staff@tacl.org"), true)
    ).resolves.toBe(false);
  });

  it("silently forces production mode for a disabled full admin", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin", disabled: true});
    await expect(
      resolveTestDataFlag(requestFrom("admin@tacl.org"), true)
    ).resolves.toBe(false);
  });

  it("honours the request from a full admin", async () => {
    mockAdmins.set("admin@tacl.org", {role: "full_admin"});
    await expect(
      resolveTestDataFlag(requestFrom("admin@tacl.org"), true)
    ).resolves.toBe(true);
  });
});

describe("resolveForceWaitlistFlag", () => {
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
