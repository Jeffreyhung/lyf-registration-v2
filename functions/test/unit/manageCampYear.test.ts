/**
 * The manageCampYear callable, driven through onCall's `run` against a fake
 * production and a fake test database. parseConfigInput / assertDateOrder
 * have their own tests in campYearConfig.test.ts; these cover how the
 * callable uses them and what it writes.
 */
import {Timestamp} from "firebase-admin/firestore";

import {callableRequest, expectHttpsError} from "./callableTestUtils";
import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState = {prodDb: new FakeFirestore(), testDb: new FakeFirestore()};
jest.mock("../../src/utils", () => ({
  db: {collection: (name: string) => mockState.prodDb.collection(name)},
  getFirestoreDb: (isProd: boolean) => (isProd ? mockState.prodDb : mockState.testDb),
  PROD_DATABASE_ID: "lyf-v2",
  TEST_DATABASE_ID: "lyf-v2-test",
}));
jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());

import {manageCampYear} from "../../src/admin/manageCampYear";

const ROOT = "root@example.com";
const PROGRAM_ADMIN = "program@example.com";
const STAFF = "staff@example.com";
const BYPASS_2026 = "camps/2026/private/bypass/emails";

// Each test speaks as this caller unless it says otherwise.
const request = (data: unknown, email: string | null = ROOT) =>
  callableRequest(data, email);

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const iso = (value: unknown) => (value as Timestamp).toDate().toISOString();

function camp2026() {
  return {
    name: "LYF Camp 2026",
    registrationFee: 550,
    siblingDiscount: 80,
    campSizeCaps: {Younger: 40, Older: 30},
    remainingSpots: {Younger: 3, Older: 0},
    registrationOpenDate: ts("2026-03-01T17:00:00.000Z"),
    registrationLateDate: ts("2026-05-01T17:00:00.000Z"),
    registrationCloseDate: ts("2026-06-15T17:00:00.000Z"),
    campStartDate: ts("2026-07-10T16:00:00.000Z"),
    campEndDate: ts("2026-07-14T16:00:00.000Z"),
    // Each year has its own audience; a new year must not inherit this.
    mailchimpListId: "be387aca9f",
    // Legacy field that must never be copied onto a public document.
    registrationBypassEmails: ["legacy@example.com"],
  };
}

const auditLog = (db: FakeFirestore) => db.all("adminAuditLog").map(({data}) => data);

beforeEach(() => {
  mockState.prodDb = new FakeFirestore()
    .seed("admins", ROOT, {role: "full_admin"})
    .seed("admins", PROGRAM_ADMIN, {role: "program_admin"})
    .seed("admins", STAFF, {role: "program_staff"})
    .seed("camps", "2026", camp2026())
    .seed(BYPASS_2026, "a@example.com", {email: "a@example.com"})
    .seed(BYPASS_2026, "b@example.com", {email: "b@example.com"});
  mockState.testDb = new FakeFirestore();
});

describe("access", () => {
  const update = {action: "updateYear", year: 2026, fields: {campsite: "Camp Wawona"}};

  it("rejects program staff and writes nothing", async () => {
    await expectHttpsError(
      manageCampYear.run(request(update, STAFF)),
      "permission-denied",
      /requires one of: full_admin, program_admin/
    );
    expect(mockState.prodDb.read("camps", "2026")?.campsite).toBeUndefined();
  });

  it("allows program admins", async () => {
    await expect(manageCampYear.run(request(update, PROGRAM_ADMIN))).resolves.toEqual({
      status: "success",
      action: "updateYear",
      target: "camps/2026",
    });
    expect(mockState.prodDb.read("camps", "2026")?.campsite).toBe("Camp Wawona");
  });

  it("rejects an unknown action", async () => {
    await expectHttpsError(manageCampYear.run(request({action: "deleteYear", year: 2026})), "invalid-argument", /Unknown action/);
  });
});

describe("updateYear", () => {
  it("refuses remainingSpots, which only the registration functions may change, and writes nothing", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "updateYear", year: 2026, fields: {remainingSpots: {Younger: 99}}})),
      "invalid-argument",
      /remainingSpots is not an editable camp year field/
    );

    expect(mockState.prodDb.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 0});
    expect(auditLog(mockState.prodDb)).toEqual([]);
  });

  it("refuses any key outside the whitelist", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "updateYear", year: 2026, fields: {ownerNotes: "x"}})),
      "invalid-argument",
      /ownerNotes is not an editable camp year field/
    );
  });

  it("refuses a change that puts the dates out of order and writes nothing", async () => {
    await expectHttpsError(
      manageCampYear.run(
        request({action: "updateYear", year: 2026, fields: {registrationCloseDate: "2026-08-01T00:00:00Z"}})
      ),
      "invalid-argument",
      /registrationCloseDate must not be after campStartDate/
    );

    expect(iso(mockState.prodDb.read("camps", "2026")?.registrationCloseDate)).toBe("2026-06-15T17:00:00.000Z");
    expect(auditLog(mockState.prodDb)).toEqual([]);
  });

  it("refuses an empty update", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "updateYear", year: 2026, fields: {}})),
      "invalid-argument",
      /No fields to update/
    );
  });

  it("refuses a year that does not exist", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "updateYear", year: 2031, fields: {campsite: "x"}})),
      "not-found",
      /camps\/2031 does not exist/
    );
  });

  it("stores dates as Timestamps, keeps the other fields, and audits before/after with the database", async () => {
    await manageCampYear.run(
      request({
        action: "updateYear",
        year: 2026,
        fields: {registrationLateDate: "2026-05-15T17:00:00Z", registrationFee: 600, showRemainingSpots: true},
      })
    );

    const camp = mockState.prodDb.read("camps", "2026")!;
    expect(iso(camp.registrationLateDate)).toBe("2026-05-15T17:00:00.000Z");
    expect(camp).toMatchObject({registrationFee: 600, showRemainingSpots: true, siblingDiscount: 80});
    expect(camp.remainingSpots).toEqual({Younger: 3, Older: 0});

    const [entry] = auditLog(mockState.prodDb);
    expect(entry).toMatchObject({
      actor: ROOT,
      action: "updateYear",
      target: "camps/2026",
      database: "lyf-v2",
      before: {registrationFee: 550, registrationBypassEmails: ["a@example.com", "b@example.com"]},
      after: {registrationFee: 600, registrationBypassEmails: ["a@example.com", "b@example.com"]},
    });
    expect(entry.at).toBeDefined();
  });

  it("reconciles the private bypass list without touching the public document", async () => {
    await manageCampYear.run(
      request({
        action: "updateYear",
        year: 2026,
        fields: {registrationBypassEmails: ["B@Example.com", "c@example.com"]},
      })
    );

    expect(mockState.prodDb.all(BYPASS_2026).map((d) => d.id).sort()).toEqual(["b@example.com", "c@example.com"]);
    expect(mockState.prodDb.read(BYPASS_2026, "c@example.com")).toMatchObject({email: "c@example.com", addedBy: ROOT});
    expect(mockState.prodDb.read(BYPASS_2026, "b@example.com")).toEqual({email: "b@example.com"});
    expect(mockState.prodDb.read("camps", "2026")?.registrationBypassEmails).toEqual(["legacy@example.com"]);
    expect(auditLog(mockState.prodDb)[0]).toMatchObject({
      before: {registrationBypassEmails: ["a@example.com", "b@example.com"]},
      after: {registrationBypassEmails: ["b@example.com", "c@example.com"]},
    });
  });
});

describe("createYear", () => {
  it("copies the source year with dates shifted, fresh spots, a default name and neither the bypass field nor the Mailchimp audience", async () => {
    const result = await manageCampYear.run(
      request({
        action: "createYear",
        year: 2027,
        sourceYear: 2026,
        overrides: {registrationFee: 575, registrationBypassEmails: ["late@example.com"]},
      })
    );

    expect(result).toEqual({status: "success", action: "createYear", target: "camps/2027"});
    const camp = mockState.prodDb.read("camps", "2027")!;
    expect(camp).toMatchObject({
      name: "LYF Camp 2027",
      registrationFee: 575,
      siblingDiscount: 80,
      campSizeCaps: {Younger: 40, Older: 30},
      remainingSpots: {Younger: 40, Older: 30},
    });
    expect(camp).not.toHaveProperty("registrationBypassEmails");
    expect(camp).not.toHaveProperty("mailchimpListId");
    expect(iso(camp.registrationOpenDate)).toBe("2027-03-01T17:00:00.000Z");
    expect(iso(camp.campStartDate)).toBe("2027-07-10T16:00:00.000Z");
    expect(mockState.prodDb.all("camps/2027/private/bypass/emails").map((d) => d.id)).toEqual(["late@example.com"]);
    expect(auditLog(mockState.prodDb)[0]).toMatchObject({
      action: "createYear",
      target: "camps/2027",
      before: null,
      after: {name: "LYF Camp 2027", registrationBypassEmails: ["late@example.com"]},
    });
  });

  it("takes the new year's Mailchimp audience from the overrides", async () => {
    await manageCampYear.run(
      request({action: "createYear", year: 2027, sourceYear: 2026, overrides: {mailchimpListId: "58dc9a95e9"}})
    );

    expect(mockState.prodDb.read("camps", "2027")).toMatchObject({mailchimpListId: "58dc9a95e9"});
  });

  it("lets campSizeCaps overrides drive the fresh remainingSpots", async () => {
    await manageCampYear.run(
      request({action: "createYear", year: 2027, sourceYear: 2026, overrides: {campSizeCaps: {Younger: 50, Older: 10}}})
    );

    expect(mockState.prodDb.read("camps", "2027")).toMatchObject({
      campSizeCaps: {Younger: 50, Older: 10},
      remainingSpots: {Younger: 50, Older: 10},
    });
  });

  it("refuses a source year that is not earlier than the new one", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "createYear", year: 2026, sourceYear: 2026})),
      "invalid-argument",
      /sourceYear must be earlier/
    );
  });

  it("refuses to overwrite a year that already exists", async () => {
    mockState.prodDb.seed("camps", "2027", {name: "exists"});
    await expectHttpsError(
      manageCampYear.run(request({action: "createYear", year: 2027, sourceYear: 2026})),
      "already-exists"
    );
    expect(mockState.prodDb.read("camps", "2027")).toEqual({name: "exists"});
  });

  it("refuses a source year that does not exist and writes nothing", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "createYear", year: 2028, sourceYear: 2025})),
      "not-found",
      /camps\/2025 does not exist/
    );
    expect(mockState.prodDb.read("camps", "2028")).toBeUndefined();
    expect(auditLog(mockState.prodDb)).toEqual([]);
  });

  it("refuses overrides that leave the shifted dates out of order", async () => {
    await expectHttpsError(
      manageCampYear.run(
        request({action: "createYear", year: 2027, sourceYear: 2026, overrides: {campEndDate: "2027-07-01T00:00:00Z"}})
      ),
      "invalid-argument",
      /campStartDate must not be after campEndDate/
    );
    expect(mockState.prodDb.read("camps", "2027")).toBeUndefined();
  });
});

describe("setSiteConfig", () => {
  it("refuses to point the site at a year that does not exist", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "setSiteConfig", config: {currentCampYear: 2029}})),
      "failed-precondition",
      /camps\/2029 does not exist/
    );
    expect(mockState.prodDb.read("config", "site")).toBeUndefined();
  });

  it("refuses an empty config", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "setSiteConfig", config: {}})),
      "invalid-argument",
      /No config to update/
    );
  });

  it("merges the pointers with the actor and audits the change", async () => {
    mockState.prodDb.seed("config", "site", {currentCampYear: 2025, preRegistrationCampYear: 2026});

    const result = await manageCampYear.run(request({action: "setSiteConfig", config: {currentCampYear: 2026}}));

    expect(result).toEqual({status: "success", action: "setSiteConfig", target: "config/site"});
    const site = mockState.prodDb.read("config", "site")!;
    expect(site).toMatchObject({currentCampYear: 2026, preRegistrationCampYear: 2026, updatedBy: ROOT});
    expect(site.updatedAt).toBeDefined();
    expect(auditLog(mockState.prodDb)[0]).toMatchObject({
      action: "setSiteConfig",
      target: "config/site",
      before: {currentCampYear: 2025},
      after: {currentCampYear: 2026, updatedBy: ROOT},
    });
  });
});

describe("copying from production", () => {
  it.each(["copyYearFromProd", "copySiteConfigFromProd"])(
    "%s is refused in production mode so nothing can ever write prod from a copy",
    async (action) => {
      await expectHttpsError(
        manageCampYear.run(request({action, year: 2026, isTestData: false})),
        "failed-precondition",
        /only available in test mode/
      );
    }
  );

  it("copyYearFromProd mirrors the year, its remainingSpots and its bypass list into the test database", async () => {
    mockState.testDb
      .seed("camps", "2026", {name: "stale", remainingSpots: {Younger: 99}})
      .seed(BYPASS_2026, "old@example.com", {email: "old@example.com"});

    const result = await manageCampYear.run(request({action: "copyYearFromProd", year: 2026, isTestData: true}));

    expect(result).toEqual({status: "success", action: "copyYearFromProd", target: "camps/2026"});
    const copy = mockState.testDb.read("camps", "2026")!;
    expect(copy).toMatchObject({name: "LYF Camp 2026", remainingSpots: {Younger: 3, Older: 0}});
    expect(copy).not.toHaveProperty("registrationBypassEmails");
    expect(mockState.testDb.all(BYPASS_2026).map((d) => d.id).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(auditLog(mockState.testDb)[0]).toMatchObject({
      action: "copyYearFromProd",
      database: "lyf-v2-test",
      before: {name: "stale", registrationBypassEmails: ["old@example.com"]},
    });
    // Production is read, never written.
    expect(mockState.prodDb.read("camps", "2026")?.name).toBe("LYF Camp 2026");
    expect(auditLog(mockState.prodDb)).toEqual([]);
  });

  it("copyYearFromProd refuses a year production does not have", async () => {
    await expectHttpsError(
      manageCampYear.run(request({action: "copyYearFromProd", year: 2030, isTestData: true})),
      "not-found",
      /does not exist in production/
    );
  });

  it("copySiteConfigFromProd requires the pointed-at years in the test database first", async () => {
    mockState.prodDb.seed("config", "site", {currentCampYear: 2026});

    await expectHttpsError(
      manageCampYear.run(request({action: "copySiteConfigFromProd", isTestData: true})),
      "failed-precondition",
      /copy it from production first/
    );
    expect(mockState.testDb.read("config", "site")).toBeUndefined();
  });

  it("copySiteConfigFromProd mirrors the pointers once the years exist in the test database", async () => {
    mockState.prodDb.seed("config", "site", {currentCampYear: 2026});
    mockState.testDb.seed("camps", "2026", {name: "LYF Camp 2026"});
    await manageCampYear.run(request({action: "copySiteConfigFromProd", isTestData: true}));
    expect(mockState.testDb.read("config", "site")).toMatchObject({currentCampYear: 2026, updatedBy: ROOT});
  });
});
