/**
 * The manageAdmin callable beyond the payload checks in
 * callablePayloads.test.ts: the lockout and self-edit guards, each action's
 * writes, and the audit log.
 */
import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";

import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState: {db: FakeFirestore} = {db: new FakeFirestore()};
jest.mock("../../src/utils", () => ({
  db: {
    collection: (name: string) => mockState.db.collection(name),
    runTransaction: (fn: never) => mockState.db.runTransaction(fn),
  },
}));
jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());

import {manageAdmin} from "../../src/admin/manageAdmin";

const ROOT = "root@example.com";
const SECOND = "second@example.com";
const STAFF = "staff@example.com";
const PROGRAM_ADMIN = "program@example.com";

function request(data: unknown, email: string | null = ROOT): CallableRequest<never> {
  return {
    data,
    rawRequest: {},
    auth: email === null ? undefined : {uid: "uid", token: {email}},
  } as unknown as CallableRequest<never>;
}

async function expectHttpsError(promise: Promise<unknown>, code: string, message?: RegExp) {
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

const auditLog = () => mockState.db.all("adminAuditLog").map(({data}) => data);

beforeEach(() => {
  mockState.db = new FakeFirestore()
    .seed("admins", ROOT, {role: "full_admin", addedBy: "setup", disabled: false})
    .seed("admins", STAFF, {role: "program_staff", addedBy: ROOT, disabled: false})
    .seed("admins", PROGRAM_ADMIN, {role: "program_admin", addedBy: ROOT, disabled: false});
});

describe("access", () => {
  it("rejects an admin whose role lacks manageAdmins", async () => {
    await expectHttpsError(
      manageAdmin.run(request({action: "add", email: "x@example.com", role: "program_staff"}, PROGRAM_ADMIN)),
      "permission-denied",
      /requires one of: full_admin/
    );
    expect(mockState.db.read("admins", "x@example.com")).toBeUndefined();
    expect(auditLog()).toEqual([]);
  });

  it("rejects a disabled full admin", async () => {
    mockState.db.seed("admins", SECOND, {role: "full_admin", disabled: true});

    await expectHttpsError(
      manageAdmin.run(request({action: "remove", email: STAFF}, SECOND)),
      "permission-denied"
    );
    expect(mockState.db.read("admins", STAFF)).toBeDefined();
  });
});

describe("the last full admin", () => {
  it.each([
    ["demote", {action: "setRole", email: ROOT, role: "program_staff"}, /cannot change your own role/],
    ["disable", {action: "setDisabled", email: ROOT, disabled: true}, /cannot disable your own account/],
    ["remove", {action: "remove", email: ROOT}, /cannot remove yourself/],
  ])("cannot %s themselves, so the roster always keeps one", async (_label, data, message) => {
    await expectHttpsError(manageAdmin.run(request(data)), "failed-precondition", message);

    expect(mockState.db.read("admins", ROOT)).toMatchObject({role: "full_admin", disabled: false});
    expect(auditLog()).toEqual([]);
  });

  it("can be demoted, disabled or removed by another full admin once there are two", async () => {
    mockState.db.seed("admins", SECOND, {role: "full_admin", addedBy: ROOT, disabled: false});

    await manageAdmin.run(request({action: "setDisabled", email: SECOND, disabled: true}));
    expect(mockState.db.read("admins", SECOND)).toMatchObject({role: "full_admin", disabled: true});

    await manageAdmin.run(request({action: "setDisabled", email: SECOND, disabled: false}));
    await manageAdmin.run(request({action: "setRole", email: SECOND, role: "health_staff"}));
    expect(mockState.db.read("admins", SECOND)).toMatchObject({role: "health_staff", disabled: false});

    await manageAdmin.run(request({action: "remove", email: SECOND}));
    expect(mockState.db.read("admins", SECOND)).toBeUndefined();
    expect(auditLog().map((e) => e.action)).toEqual(["setDisabled", "setDisabled", "setRole", "remove"]);
  });
});

describe("actions", () => {
  it("add: normalizes the email, stamps the actor and refuses a duplicate", async () => {
    const result = await manageAdmin.run(
      request({action: "add", email: "New@Example.com", role: "health_staff"})
    );

    expect(result).toEqual({status: "success", action: "add", email: "new@example.com"});
    const doc = mockState.db.read("admins", "new@example.com");
    expect(doc).toMatchObject({role: "health_staff", addedBy: ROOT, disabled: false});
    expect(doc?.addedAt).toBeDefined();

    await expectHttpsError(
      manageAdmin.run(request({action: "add", email: "new@example.com", role: "program_staff"})),
      "already-exists",
      /already an admin/
    );
    expect(mockState.db.read("admins", "new@example.com")?.role).toBe("health_staff");
    expect(auditLog()).toHaveLength(1);
  });

  it("setRole: changes only the role and keeps the rest of the document", async () => {
    const result = await manageAdmin.run(request({action: "setRole", email: STAFF, role: "program_admin"}));

    expect(result).toEqual({status: "success", action: "setRole", email: STAFF});
    expect(mockState.db.read("admins", STAFF)).toEqual({
      role: "program_admin",
      addedBy: ROOT,
      disabled: false,
    });
  });

  it("setRole: refuses an unknown target", async () => {
    await expectHttpsError(
      manageAdmin.run(request({action: "setRole", email: "ghost@example.com", role: "program_admin"})),
      "not-found",
      /not an admin/
    );
    expect(auditLog()).toEqual([]);
  });

  it("setDisabled: toggles the flag without touching the role", async () => {
    await manageAdmin.run(request({action: "setDisabled", email: STAFF, disabled: true}));
    expect(mockState.db.read("admins", STAFF)).toMatchObject({role: "program_staff", disabled: true});

    await manageAdmin.run(request({action: "setDisabled", email: STAFF, disabled: false}));
    expect(mockState.db.read("admins", STAFF)).toMatchObject({role: "program_staff", disabled: false});
  });

  it("remove: deletes the document and refuses a second removal", async () => {
    await manageAdmin.run(request({action: "remove", email: STAFF}));
    expect(mockState.db.read("admins", STAFF)).toBeUndefined();

    await expectHttpsError(manageAdmin.run(request({action: "remove", email: STAFF})), "not-found");
    expect(auditLog()).toHaveLength(1);
  });
});

describe("the audit log", () => {
  it("records actor, action, normalized target, before and after for a change", async () => {
    await manageAdmin.run(request({action: "setRole", email: "Staff@Example.com", role: "program_admin"}));

    const [entry] = auditLog();
    expect(entry).toMatchObject({
      actor: ROOT,
      action: "setRole",
      target: STAFF,
      before: {role: "program_staff", addedBy: ROOT, disabled: false},
      after: {role: "program_admin", addedBy: ROOT, disabled: false},
    });
    expect(entry.at).toBeDefined();
  });

  it("records a null `before` for add and a null `after` for remove", async () => {
    await manageAdmin.run(request({action: "add", email: "new@example.com", role: "program_staff"}));
    await manageAdmin.run(request({action: "remove", email: "new@example.com"}));

    const [added, removed] = auditLog();
    expect(added).toMatchObject({action: "add", before: null, after: {role: "program_staff", addedBy: ROOT, disabled: false}});
    expect(removed).toMatchObject({action: "remove", before: {role: "program_staff"}, after: null});
  });

  it("writes nothing when the action is refused", async () => {
    await expectHttpsError(
      manageAdmin.run(request({action: "setDisabled", email: ROOT, disabled: true})),
      "failed-precondition"
    );
    await expectHttpsError(
      manageAdmin.run(request({action: "setRole", email: "ghost@example.com", role: "program_staff"})),
      "not-found"
    );

    expect(auditLog()).toEqual([]);
  });
});
