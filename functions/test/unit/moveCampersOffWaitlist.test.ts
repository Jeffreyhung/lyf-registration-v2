/**
 * The moveCampersOffWaitlist admin callable beyond the payload checks in
 * callablePayloads.test.ts: capacity bookkeeping, failure paths and the
 * email that goes out.
 */
import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";
import {RegistrationStatus} from "lyf-registration-schemas";

import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState = {prodDb: new FakeFirestore(), testDb: new FakeFirestore()};
const mockSendMail = jest.fn();
const mockGetFirestoreDb = jest.fn((isProd: boolean) =>
  isProd ? mockState.prodDb : mockState.testDb
);
jest.mock("../../src/utils", () => ({
  db: {collection: (name: string) => mockState.prodDb.collection(name)},
  getFirestoreDb: mockGetFirestoreDb,
  REGISTRATION_EMAIL: "lyf@example.com",
  emailTransport: {sendMail: mockSendMail},
  getFirstName: (name: string) => name.split(" ")[0],
  combineNames: (names: string[]) =>
    names.length <= 2 ?
      names.join(" and ") :
      `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`,
  sanitizeForEmailHeader: (value: string) => value.replace(/[\r\n]/g, " ").trim(),
}));
const mockSlackError = jest.fn();
jest.mock("../../src/slack/slackChannelWebhooks", () => ({
  sendMessageToRegistrationErrorMessages: mockSlackError,
}));
jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());

import {moveCampersOffWaitlist} from "../../src/registration/moveCampersOffWaitlist";

const ADMIN = "root@example.com";
const PARENT = "pat@example.com";
const REGISTRATIONS = "camps/2026/registrations";

function request(data: unknown, email: string | null = ADMIN): CallableRequest<never> {
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

const move = (overrides: Record<string, unknown> = {}) => ({
  parentNames: ["Pat Lin", "Sam Lin"],
  parentEmails: [PARENT, "sam@example.com"],
  campYear: 2026,
  camperName: "Mei Lin",
  registrationId: "c1",
  campTrack: "Older",
  isTestData: false,
  ...overrides,
});

function seedCamp(db: FakeFirestore, registration: Record<string, unknown> | null) {
  db.seed("camps", "2026", {
    remainingSpots: {Younger: 2, Older: 1},
    emailHeaderImageUrl: "https://img.example.com/header.png",
  });
  if (registration) db.seed(REGISTRATIONS, "c1", registration);
  return db;
}

beforeEach(() => {
  mockState.prodDb = new FakeFirestore()
    .seed("admins", ADMIN, {role: "full_admin"})
    .seed("admins", "staff@example.com", {role: "program_admin"});
  mockState.testDb = new FakeFirestore();
  mockGetFirestoreDb.mockClear();
  mockSendMail.mockReset().mockResolvedValue({accepted: [PARENT]});
  mockSlackError.mockReset().mockResolvedValue(undefined);
});

describe("access", () => {
  it("rejects an admin whose role lacks manageWaitlist", async () => {
    seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});

    await expectHttpsError(
      moveCampersOffWaitlist.run(request(move(), "staff@example.com")),
      "permission-denied",
      /requires one of: full_admin/
    );

    expect(mockState.prodDb.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.WAITLIST);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("capacity", () => {
  it("grants the spot: pending payment, reserved, and the track decremented once", async () => {
    const db = seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});

    await moveCampersOffWaitlist.run(request(move()));

    expect(db.read(REGISTRATIONS, "c1")).toMatchObject({
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
    });
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });

  it("does not decrement again for a registration that already holds a spot (button clicked twice)", async () => {
    const db = seedCamp(mockState.prodDb, {
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
      campTrack: "Older",
    });

    await moveCampersOffWaitlist.run(request(move()));

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 1});
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("floors the track at zero when the admin grants a spot on a full track", async () => {
    const db = seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});
    db.seed("camps", "2026", {remainingSpots: {Younger: 2, Older: 0}});

    await moveCampersOffWaitlist.run(request(move()));

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
    expect(db.read(REGISTRATIONS, "c1")?.spotReserved).toBe(true);
  });

  it("falls back to the request's track when the registration has none recorded", async () => {
    const db = seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST});

    await moveCampersOffWaitlist.run(request(move({campTrack: "Younger"})));

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 1});
  });

  it("prefers the registration's own track over the one in the request", async () => {
    const db = seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Younger"});

    await moveCampersOffWaitlist.run(request(move({campTrack: "Older"})));

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 1, Older: 1});
  });

  it("writes to the test database for test data", async () => {
    seedCamp(mockState.testDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});

    await moveCampersOffWaitlist.run(request(move({isTestData: true})));

    expect(mockGetFirestoreDb).toHaveBeenCalledWith(false);
    expect(mockState.testDb.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
    expect(mockState.prodDb.read(REGISTRATIONS, "c1")).toBeUndefined();
  });
});

describe("failures", () => {
  it("returns a 402 result, reports to Slack and sends no email when the registration does not exist", async () => {
    const db = seedCamp(mockState.prodDb, null);

    const result = await moveCampersOffWaitlist.run(request(move()));

    expect(result).toEqual({
      status: "error",
      code: 402,
      message: "Failed to move campers off waitlist",
    });
    expect(mockSlackError).toHaveBeenCalledWith("Failed to move campers off waitlist: Mei Lin");
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 1});
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("surfaces a mail failure after the spot was already granted", async () => {
    const db = seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});
    mockSendMail.mockRejectedValue(new Error("SMTP down"));

    await expect(moveCampersOffWaitlist.run(request(move()))).rejects.toThrow("SMTP down");

    // The move stands even though the parent was not told.
    expect(db.read(REGISTRATIONS, "c1")?.status).toBe(RegistrationStatus.PENDING_PAYMENT);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });
});

describe("the email", () => {
  it("goes to every parent email with the camper's name, the parents' first names and the camp's header image", async () => {
    seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});

    const result = await moveCampersOffWaitlist.run(request(move()));

    expect(result).toEqual({accepted: [PARENT]});
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.from).toBe("TACL-LYF <lyf@example.com>");
    expect(mail.to).toEqual([PARENT, "sam@example.com"]);
    expect(mail.subject).toBe(
      "[TACL LYF] Congrats - Mei Lin is off the waitlist! Finish registration now to secure your spot!"
    );
    expect(mail.html).toContain("Pat and Sam");
    expect(mail.html).toContain("Mei Lin");
    expect(mail.html).toContain("2026");
    // Mustache HTML-escapes the URL, so the slashes come out as entities.
    expect(mail.html).toContain("src=\"https:&#x2F;&#x2F;img.example.com&#x2F;header.png\"");
  });

  it("strips line breaks a camper name could smuggle into the subject", async () => {
    seedCamp(mockState.prodDb, {status: RegistrationStatus.WAITLIST, campTrack: "Older"});

    await moveCampersOffWaitlist.run(request(move({camperName: "Mei\r\nBcc: x@evil.example"})));

    const {subject} = mockSendMail.mock.calls[0][0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Mei  Bcc: x@evil.example");
  });
});
