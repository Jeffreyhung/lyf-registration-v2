import {HttpsError} from "firebase-functions/v2/https";
import {
  SchemaValidationError,
  validateManageAdminRequest,
  validateRegistrationPayload,
} from "lyf-registration-schemas";

import {parseCallablePayload} from "../../src/utils/validate";

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
}

describe("parseCallablePayload", () => {
  it("returns the validator's output for a valid payload", () => {
    const data = {action: "remove", email: "ada@example.com"};
    expect(parseCallablePayload(validateManageAdminRequest, data)).toEqual(data);
  });

  it("returns the stripped payload, not the raw request data", () => {
    const raw = {
      campYear: 2026,
      family: {id: "fam1", city: "San Jose"},
      parents: [{id: "p1", email: "ada@example.com", firstName: "Ada"}],
      campers: [{firstName: "Lin", lastName: "Lovelace", grade: 6, health: {}}],
      demographics: [{born: "US"}],
      donation: 0,
      household: {},
      successUrl: "https://lyf-registration.tacl.org/registration",
      cancelUrl: "https://lyf-registration.tacl.org/registration",
    };

    const payload = parseCallablePayload(validateRegistrationPayload, raw);

    expect(payload.family).toEqual({city: "San Jose"});
    expect(payload.parents[0]).not.toHaveProperty("id");
    expect(payload.campers[0]).not.toHaveProperty("health");
  });

  it("translates a validation failure into an invalid-argument HttpsError listing every issue path", () => {
    const error = caught(() =>
      parseCallablePayload(validateManageAdminRequest, {
        action: "promote",
        email: "not-an-email",
        extra: true,
      })
    );

    expect(error).toBeInstanceOf(HttpsError);
    const httpsError = error as HttpsError;
    expect(httpsError.code).toBe("invalid-argument");
    expect(httpsError.message).toMatch(/action/);
    expect(httpsError.message).toMatch(/email/);
    expect(httpsError.message).toMatch(/extra/);
    expect(httpsError.details).toEqual({
      issues: expect.arrayContaining([
        expect.objectContaining({path: "action"}),
        expect.objectContaining({path: "email"}),
      ]),
    });
  });

  it("names nested paths so the client can point at the field", () => {
    const error = caught(() =>
      parseCallablePayload(validateRegistrationPayload, {
        campYear: 2026,
        family: {},
        parents: [{email: "ada@example.com"}],
        campers: [{firstName: "Lin", grade: 99}],
        demographics: [{}],
        donation: 0,
        household: {},
        successUrl: "https://lyf-registration.tacl.org/registration",
        cancelUrl: "https://lyf-registration.tacl.org/registration",
      })
    ) as HttpsError;

    expect(error.code).toBe("invalid-argument");
    expect(error.message).toMatch(/campers\[0\]\.grade/);
  });

  it("rejects a non-object body", () => {
    for (const body of [undefined, null, "data", 42, []]) {
      const error = caught(() =>
        parseCallablePayload(validateManageAdminRequest, body)
      ) as HttpsError;
      expect(error.code).toBe("invalid-argument");
    }
  });

  it("also recognises a SchemaValidationError from another copy of the package", () => {
    const foreign = new Error("Invalid X (1 issue): a: b");
    foreign.name = "SchemaValidationError";
    (foreign as Error & {issues: unknown}).issues = [{path: "a", message: "b"}];
    const validator = () => {
      throw foreign;
    };

    const error = caught(() => parseCallablePayload(validator, {})) as HttpsError;

    expect(error).toBeInstanceOf(HttpsError);
    expect(error.code).toBe("invalid-argument");
    expect(error.message).toBe(foreign.message);
  });

  it("re-throws anything that is not a validation failure", () => {
    const boom = new TypeError("boom");
    const validator = () => {
      throw boom;
    };

    expect(caught(() => parseCallablePayload(validator, {}))).toBe(boom);
    expect(
      caught(() => parseCallablePayload(validator, {}))
    ).not.toBeInstanceOf(SchemaValidationError);
  });
});
