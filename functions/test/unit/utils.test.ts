// src/utils.ts opens Firestore, Stripe and SMTP clients at import time.
// Replace those with inert stubs so the pure helpers can be exercised.
jest.mock("dotenv", () => ({config: jest.fn()}));
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn((databaseId: string) => ({databaseId})),
}));
jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((apiKey: string) => ({apiKey})),
}));
jest.mock("nodemailer", () => ({createTransport: jest.fn(() => ({}))}));

import {
  combineNames,
  db,
  getFirestoreDb,
  getFirstName,
  getStripe,
  RegistrationType,
  sanitizeForEmailHeader,
  stripe,
  STRIPE_APP_TAG,
  StripeWebhookEventType,
  testDb,
  testStripe,
} from "../../src/utils";

describe("getFirstName", () => {
  it("returns the part before the first space", () => {
    expect(getFirstName("Ada Lovelace")).toBe("Ada");
  });

  it("returns a single name unchanged", () => {
    expect(getFirstName("Ada")).toBe("Ada");
  });

  it("only takes the first of several given names", () => {
    expect(getFirstName("Mary Ann Smith")).toBe("Mary");
  });
});

describe("combineNames", () => {
  it("returns an empty string for no names", () => {
    expect(combineNames([])).toBe("");
  });

  it("returns a single name as-is", () => {
    expect(combineNames(["Ada"])).toBe("Ada");
  });

  it("joins two names with 'and'", () => {
    expect(combineNames(["Ada", "Grace"])).toBe("Ada and Grace");
  });

  it("uses an Oxford comma for three or more names", () => {
    expect(combineNames(["Ada", "Grace", "Katherine"])).toBe(
      "Ada, Grace, and Katherine"
    );
    expect(combineNames(["A", "B", "C", "D"])).toBe("A, B, C, and D");
  });
});

describe("sanitizeForEmailHeader", () => {
  it("leaves ordinary values alone", () => {
    expect(sanitizeForEmailHeader("Camp 2026 Confirmation")).toBe(
      "Camp 2026 Confirmation"
    );
  });

  it("replaces CR and LF so a name cannot inject extra headers", () => {
    expect(sanitizeForEmailHeader("Ada\r\nBcc: evil@example.com")).toBe(
      "Ada  Bcc: evil@example.com"
    );
    expect(sanitizeForEmailHeader("Ada\nLovelace")).toBe("Ada Lovelace");
  });

  it("trims surrounding whitespace, including stripped line breaks", () => {
    expect(sanitizeForEmailHeader("\n  Ada  \r\n")).toBe("Ada");
  });
});

describe("environment selection", () => {
  it("routes production and test data to separate Firestore databases", () => {
    expect(getFirestoreDb(true)).toBe(db);
    expect(getFirestoreDb(false)).toBe(testDb);
    expect(db).not.toBe(testDb);
  });

  it("routes production and test data to separate Stripe clients", () => {
    expect(getStripe(true)).toBe(stripe);
    expect(getStripe(false)).toBe(testStripe);
    expect(stripe).not.toBe(testStripe);
  });
});

describe("constants shared with the website and Stripe webhook", () => {
  it("tags checkout sessions as v2", () => {
    expect(STRIPE_APP_TAG).toBe("v2");
  });

  it("keeps the registration type strings used in Mailchimp tags", () => {
    expect(RegistrationType.PreRegistration).toBe("PreReg");
    expect(RegistrationType.Registration).toBe("Reg");
  });

  it("keeps the webhook event type ordering", () => {
    expect(StripeWebhookEventType.Registration).toBe(0);
    expect(StripeWebhookEventType.PreRegistration).toBe(1);
    expect(StripeWebhookEventType.Donation).toBe(2);
  });
});
