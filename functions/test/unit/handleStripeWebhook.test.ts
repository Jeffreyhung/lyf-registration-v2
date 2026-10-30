/**
 * Drives the exported onRequest handlers (prod and test endpoints) with fake
 * express request/response objects. Stripe, the fulfilment modules and Slack
 * are mocked; the `_processedEvents` idempotency records land in the fake
 * Firestore so the claim/release behaviour can be asserted on.
 */
import {EventEmitter} from "events";
import type {Request} from "firebase-functions/v2/https";
import type {Response} from "express";

import {FakeFirestore} from "./fakeFirestore";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockState = {prodDb: new FakeFirestore(), testDb: new FakeFirestore()};
// The handler captures getFirestoreDb(isProd) once at import, so hand it
// stable handles that delegate to the fake of the current test.
const mockProdDbHandle = {
  collection: (name: string) => mockState.prodDb.collection(name),
};
const mockTestDbHandle = {
  collection: (name: string) => mockState.testDb.collection(name),
};
function mockStripeClient(secret: string) {
  return {
    webhooks: {
      // Stands in for signature verification: the signature header must be
      // the one minted for this endpoint's secret, otherwise it is invalid.
      constructEvent: jest.fn((body: Buffer, sig: string, usedSecret: string) => {
        if (usedSecret !== secret || sig !== `sig:${secret}`) {
          throw new Error("No signatures found matching the expected signature");
        }
        return JSON.parse(body.toString());
      }),
    },
    checkout: {sessions: {retrieve: jest.fn()}},
  };
}
const mockProdStripe = mockStripeClient("whsec_prod");
const mockTestStripe = mockStripeClient("whsec_test");
jest.mock("../../src/utils", () => ({
  stripeEndpointSecret: "whsec_prod",
  testStripeEndpointSecret: "whsec_test",
  STRIPE_APP_TAG: "v2",
  StripeWebhookEventType: {Registration: 0, PreRegistration: 1, Donation: 2},
  getFirestoreDb: (isProd: boolean) => (isProd ? mockProdDbHandle : mockTestDbHandle),
  getStripe: (isProd: boolean) => (isProd ? mockProdStripe : mockTestStripe),
}));

const mockFulfillRegistration = jest.fn();
jest.mock("../../src/registration/fullfillRegistration", () => ({
  fulfillRegistration: mockFulfillRegistration,
}));
const mockReleaseHolds = jest.fn();
jest.mock("../../src/registration/releaseRegistrationHolds", () => ({
  releaseRegistrationHolds: mockReleaseHolds,
}));
const mockFulfillPreRegistrations = jest.fn();
jest.mock("../../src/preRegistration/fulfillPreRegistrations", () => ({
  fulfillPreRegistrations: mockFulfillPreRegistrations,
}));
const mockSlackCamp = jest.fn();
const mockSlackError = jest.fn();
jest.mock("../../src/slack/slackChannelWebhooks", () => ({
  sendMessageToRegistrationForCampChannel: mockSlackCamp,
  sendMessageToRegistrationErrorMessages: mockSlackError,
}));
const mockCaptureException = jest.fn();
jest.mock("@sentry/node", () => {
  const scope = {
    setTag: jest.fn(),
    setTransactionName: jest.fn(),
    setSDKProcessingMetadata: jest.fn(),
    setUser: jest.fn(),
    setContext: jest.fn(),
  };
  return {
    captureException: mockCaptureException,
    addBreadcrumb: jest.fn(),
    withIsolationScope: (fn: (s: typeof scope) => unknown) => fn(scope),
    startSpan: (_opts: unknown, fn: () => unknown) => fn(),
    flush: async () => true,
  };
});

import {
  handleStripeWebhook,
  handleTestStripeWebhook,
} from "../../src/stripe/handleStripeWebhook";

const PROCESSED = "_processedEvents";
const PROD_SIG = "sig:whsec_prod";
const TEST_SIG = "sig:whsec_test";

type FakeResponse = Response & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

/** The subset of express.Response the handler and the cors middleware use. */
function makeResponse(): FakeResponse {
  const emitter = new EventEmitter();
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    headersSent: false,
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    setHeader(key: string, value: string) {
      res.headers[key.toLowerCase()] = value;
      return res;
    },
    getHeader(key: string) {
      return res.headers[key.toLowerCase()];
    },
    set(key: string, value: string) {
      return res.setHeader(key, value);
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      res.headersSent = true;
      return res;
    },
    send(body?: unknown) {
      if (body !== undefined) res.body = body;
      res.headersSent = true;
      return res;
    },
    end() {
      res.headersSent = true;
      return res;
    },
  };
  return res as unknown as FakeResponse;
}

function makeRequest(opts: {
  method?: string;
  signature?: string;
  event?: object;
  rawBody?: Buffer | undefined;
}): Request {
  const rawBody =
    "rawBody" in opts ?
      opts.rawBody :
      opts.event === undefined ? undefined : Buffer.from(JSON.stringify(opts.event));
  return {
    method: opts.method ?? "POST",
    headers:
      opts.signature === undefined ? {} : {"stripe-signature": opts.signature},
    rawBody,
    url: "/",
    originalUrl: "/",
  } as unknown as Request;
}

function event(type: string, id = "evt_1", object: object = {id: "cs_1"}) {
  return {id, type, data: {object}};
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    metadata: {app: "v2", eventType: "0"},
    line_items: {data: []},
    amount_total: 12345,
    customer_email: "pat@example.com",
    ...overrides,
  };
}

async function post(
  handler: typeof handleStripeWebhook,
  signature: string,
  payload: object
) {
  const res = makeResponse();
  await handler(makeRequest({signature, event: payload}), res);
  return res;
}

beforeEach(() => {
  mockState.prodDb = new FakeFirestore();
  mockState.testDb = new FakeFirestore();
  mockProdStripe.webhooks.constructEvent.mockClear();
  mockTestStripe.webhooks.constructEvent.mockClear();
  mockProdStripe.checkout.sessions.retrieve.mockReset().mockResolvedValue(session());
  mockTestStripe.checkout.sessions.retrieve.mockReset().mockResolvedValue(session());
  mockFulfillRegistration.mockReset().mockResolvedValue(undefined);
  mockFulfillPreRegistrations.mockReset().mockResolvedValue(undefined);
  mockReleaseHolds.mockReset().mockResolvedValue(0);
  mockSlackCamp.mockReset().mockResolvedValue(undefined);
  mockSlackError.mockReset().mockResolvedValue(undefined);
  mockCaptureException.mockReset();
});

function expectNoSideEffects() {
  expect(mockProdStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  expect(mockTestStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  expect(mockFulfillRegistration).not.toHaveBeenCalled();
  expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
  expect(mockReleaseHolds).not.toHaveBeenCalled();
  expect(mockState.prodDb.all(PROCESSED)).toEqual([]);
  expect(mockState.testDb.all(PROCESSED)).toEqual([]);
}

describe("request gate", () => {
  it.each(["GET", "HEAD", "PUT"])("answers %s with 405 before looking at the body", async (method) => {
    const res = makeResponse();
    await handleStripeWebhook(makeRequest({method, signature: PROD_SIG, event: event("x")}), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(mockProdStripe.webhooks.constructEvent).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("rejects a POST without a stripe-signature header before verification or Firestore", async () => {
    const res = makeResponse();
    await handleStripeWebhook(makeRequest({event: event("checkout.session.completed")}), res);

    expect(res.statusCode).toBe(400);
    expect(mockProdStripe.webhooks.constructEvent).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("rejects a POST without a body", async () => {
    const res = makeResponse();
    await handleStripeWebhook(makeRequest({signature: PROD_SIG, rawBody: undefined}), res);

    expect(res.statusCode).toBe(400);
    expect(mockProdStripe.webhooks.constructEvent).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("rejects an invalid signature with 400, reports it, and touches nothing", async () => {
    const res = await post(handleStripeWebhook, "sig:forged", event("checkout.session.completed"));

    expect(res.statusCode).toBe(400);
    expect(mockProdStripe.webhooks.constructEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expectNoSideEffects();
  });
});

describe("prod / test endpoint separation", () => {
  it("verifies the prod endpoint with the prod secret and fulfils against the prod database and Stripe", async () => {
    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({received: true});
    const [, , secret] = mockProdStripe.webhooks.constructEvent.mock.calls[0];
    expect(secret).toBe("whsec_prod");
    expect(mockProdStripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1", {
      expand: ["line_items.data.price.product", "payment_intent.payment_method"],
    });
    expect(mockTestStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mockFulfillRegistration).toHaveBeenCalledWith(
      mockProdDbHandle,
      expect.objectContaining({id: "cs_1"}),
      false
    );
    expect(mockState.prodDb.read(PROCESSED, "evt_1")).toBeDefined();
    expect(mockState.testDb.read(PROCESSED, "evt_1")).toBeUndefined();
  });

  it("verifies the test endpoint with the test secret and fulfils as test data against the test database", async () => {
    const res = await post(handleTestStripeWebhook, TEST_SIG, event("checkout.session.completed"));

    expect(res.statusCode).toBe(200);
    const [, , secret] = mockTestStripe.webhooks.constructEvent.mock.calls[0];
    expect(secret).toBe("whsec_test");
    expect(mockTestStripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(mockProdStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mockFulfillRegistration).toHaveBeenCalledWith(
      mockTestDbHandle,
      expect.objectContaining({id: "cs_1"}),
      true
    );
    expect(mockState.testDb.read(PROCESSED, "evt_1")).toBeDefined();
    expect(mockState.prodDb.read(PROCESSED, "evt_1")).toBeUndefined();
  });

  it("does not accept a prod-signed event on the test endpoint (or vice versa)", async () => {
    const onTest = await post(handleTestStripeWebhook, PROD_SIG, event("checkout.session.completed"));
    const onProd = await post(handleStripeWebhook, TEST_SIG, event("checkout.session.completed"));

    expect(onTest.statusCode).toBe(400);
    expect(onProd.statusCode).toBe(400);
    expectNoSideEffects();
  });

  it("ignores a checkout session that was not created by this app (no STRIPE_APP_TAG) but still acknowledges it", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
      session({metadata: {eventType: "0"}})
    );

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(res.statusCode).toBe(200);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
    expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
    expect(mockSlackError).not.toHaveBeenCalled();
    expect(mockState.prodDb.read(PROCESSED, "evt_1")?.processedAt).toBeDefined();
  });

  it("ignores a session tagged for another app (e.g. v1)", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
      session({metadata: {app: "v1", eventType: "0"}})
    );

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(res.statusCode).toBe(200);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("claims the event id with a typed, expiring record and stamps processedAt once handled", async () => {
    const before = Date.now();
    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_42"));

    const claim = mockState.prodDb.read(PROCESSED, "evt_42")!;
    expect(claim.type).toBe("checkout.session.completed");
    expect(claim.receivedAt).toBeDefined();
    expect(claim.processedAt).toBeDefined();
    const expiresAt = (claim.expiresAt as {toMillis: () => number}).toMillis();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDays);
  });

  it("treats a second delivery of the same event id as a no-op and still answers 200", async () => {
    const payload = event("checkout.session.completed", "evt_dup");
    await post(handleStripeWebhook, PROD_SIG, payload);
    mockFulfillRegistration.mockClear();
    mockProdStripe.checkout.sessions.retrieve.mockClear();

    const res = await post(handleStripeWebhook, PROD_SIG, payload);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({received: true});
    expect(mockProdStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });

  it("skips an event whose claim exists but was never marked processed (a concurrent delivery still in flight)", async () => {
    mockState.prodDb.seed(PROCESSED, "evt_inflight", {type: "checkout.session.completed"});

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_inflight"));

    expect(res.statusCode).toBe(200);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });

  it("keeps prod and test claims apart: the same event id is processed once per database", async () => {
    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_same"));
    await post(handleTestStripeWebhook, TEST_SIG, event("checkout.session.completed", "evt_same"));

    expect(mockFulfillRegistration).toHaveBeenCalledTimes(2);
  });
});

describe("dispatch", () => {
  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "routes %s with eventType Registration to fulfillRegistration with the expanded session",
    async (type) => {
      const expanded = session({line_items: {data: [{description: "LYF Camp 2026 Registration: Mei Lin"}]}});
      mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(expanded);

      await post(handleStripeWebhook, PROD_SIG, event(type));

      expect(mockFulfillRegistration).toHaveBeenCalledTimes(1);
      expect(mockFulfillRegistration).toHaveBeenCalledWith(mockProdDbHandle, expanded, false);
      expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
      expect(mockReleaseHolds).not.toHaveBeenCalled();
    }
  );

  it("routes eventType PreRegistration to fulfillPreRegistrations", async () => {
    const expanded = session({metadata: {app: "v2", eventType: "1"}});
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(expanded);

    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(mockFulfillPreRegistrations).toHaveBeenCalledWith(mockProdDbHandle, expanded, false);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });

  it("announces a Donation in the camp channel with the amount in dollars and the payer's email", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
      session({metadata: {app: "v2", eventType: "2"}, amount_total: 5000, customer_email: null,
        customer_details: {email: "donor@example.com"}})
    );

    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(mockSlackCamp).toHaveBeenCalledWith("Donation: 50 from donor@example.com");
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
    expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
  });

  it("reports an unknown eventType on our own session to the error channel without fulfilling anything", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
      session({metadata: {app: "v2", eventType: "7"}})
    );

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(res.statusCode).toBe(200);
    expect(mockSlackError).toHaveBeenCalledWith("Invalid event type: 7");
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
    expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
    expect(mockState.prodDb.read(PROCESSED, "evt_1")?.processedAt).toBeDefined();
  });

  it("treats a session with no eventType as unknown", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(session({metadata: {app: "v2"}}));

    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed"));

    expect(mockSlackError).toHaveBeenCalledWith("Invalid event type: undefined");
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });

  it("releases held spots when a Registration checkout session expires", async () => {
    const expanded = session({metadata: {app: "v2", eventType: "0"}});
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(expanded);

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.expired"));

    expect(res.statusCode).toBe(200);
    expect(mockProdStripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1", {
      expand: ["line_items.data.price.product"],
    });
    expect(mockReleaseHolds).toHaveBeenCalledWith(mockProdDbHandle, expanded);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
  });

  it.each([["PreRegistration", "1"], ["Donation", "2"]])(
    "releases nothing when a %s session expires",
    async (_label, eventType) => {
      mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
        session({metadata: {app: "v2", eventType}})
      );

      const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.expired"));

      expect(res.statusCode).toBe(200);
      expect(mockReleaseHolds).not.toHaveBeenCalled();
    }
  );

  it("ignores an expired session from another app", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockResolvedValue(
      session({metadata: {app: "v1", eventType: "0"}})
    );

    await post(handleStripeWebhook, PROD_SIG, event("checkout.session.expired"));

    expect(mockReleaseHolds).not.toHaveBeenCalled();
  });

  it.each(["payment_intent.succeeded", "charge.refunded", "checkout.session.async_payment_failed"])(
    "acknowledges an unhandled event type (%s) with 200, no Stripe or fulfilment calls, and a processed claim",
    async (type) => {
      const res = await post(handleStripeWebhook, PROD_SIG, event(type, "evt_other"));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({received: true});
      expect(mockProdStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(mockFulfillRegistration).not.toHaveBeenCalled();
      expect(mockFulfillPreRegistrations).not.toHaveBeenCalled();
      expect(mockReleaseHolds).not.toHaveBeenCalled();
      expect(mockSlackError).not.toHaveBeenCalled();
      expect(mockState.prodDb.read(PROCESSED, "evt_other")?.processedAt).toBeDefined();
    }
  );
});

describe("failures during fulfilment", () => {
  it("answers 500, reports the error, and releases the claim so Stripe's retry is processed again", async () => {
    mockFulfillRegistration.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const first = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_fail"));

    expect(first.statusCode).toBe(500);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockSlackError).toHaveBeenCalledWith("Failed to handle an event");
    // Design: the claim is deleted on failure so the event is NOT marked processed.
    expect(mockState.prodDb.read(PROCESSED, "evt_fail")).toBeUndefined();

    const retry = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_fail"));

    expect(retry.statusCode).toBe(200);
    expect(mockFulfillRegistration).toHaveBeenCalledTimes(2);
    expect(mockState.prodDb.read(PROCESSED, "evt_fail")?.processedAt).toBeDefined();
  });

  it("also releases the claim when Stripe's session retrieval fails", async () => {
    mockProdStripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error("rate limited"));

    const res = await post(handleStripeWebhook, PROD_SIG, event("checkout.session.completed", "evt_retrieve"));

    expect(res.statusCode).toBe(500);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
    expect(mockState.prodDb.read(PROCESSED, "evt_retrieve")).toBeUndefined();
  });

  it("lets a Firestore error while claiming the event surface as a 500 without fulfilling", async () => {
    const broken = new FakeFirestore();
    const create = jest
      .spyOn(Object.getPrototypeOf(broken.collection(PROCESSED).doc("x")), "create")
      .mockRejectedValue(new Error("UNAVAILABLE"));
    mockState.prodDb = broken;

    const res = makeResponse();
    await expect(
      handleStripeWebhook(
        makeRequest({signature: PROD_SIG, event: event("checkout.session.completed", "evt_claim")}),
        res
      )
    ).rejects.toThrow("UNAVAILABLE");

    expect(res.statusCode).toBe(500);
    expect(mockFulfillRegistration).not.toHaveBeenCalled();
    create.mockRestore();
  });
});
