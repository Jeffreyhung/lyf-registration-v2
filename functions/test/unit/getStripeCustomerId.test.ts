// ../utils opens real Firestore and Stripe clients at import time; swap in a
// Stripe stub whose customers.create we can observe. Only names prefixed
// with "mock" may be referenced from a hoisted jest.mock factory.
const mockCreate = jest.fn();
const mockGetStripe = jest.fn(() => ({customers: {create: mockCreate}}));
jest.mock("../../src/utils", () => ({getStripe: mockGetStripe}));

import {getStripeCustomerId} from "../../src/registrationUtils/getStripeCustomerId";
import {FakeFirestore} from "./fakeFirestore";

const PARENTS = "families/fam/parents";
const PARENT_PATH = `${PARENTS}/ada@example.com`;

describe("getStripeCustomerId", () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue({id: "cus_new"});
    mockGetStripe.mockClear();
  });

  it("creates a bare customer when there is no parent ref", async () => {
    const id = await getStripeCustomerId(undefined, "ada@example.com");

    expect(id).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith({email: "ada@example.com"});
  });

  it("creates a bare customer when the parent document has no data", async () => {
    const db = new FakeFirestore();

    const id = await getStripeCustomerId(db.doc(PARENT_PATH).as(), "ada@example.com");

    expect(id).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith({email: "ada@example.com"});
    // Nothing to write the id back onto.
    expect(db.read(PARENTS, "ada@example.com")).toBeUndefined();
  });

  it("reuses the customer id stored on the parent", async () => {
    const db = new FakeFirestore().seed(PARENTS, "ada@example.com", {
      firstName: "Ada",
      lastName: "Lovelace",
      stripeCustomerId: "cus_existing",
    });

    const id = await getStripeCustomerId(db.doc(PARENT_PATH).as(), "ada@example.com");

    expect(id).toBe("cus_existing");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a named customer and stores the id on the parent", async () => {
    const db = new FakeFirestore().seed(PARENTS, "ada@example.com", {
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const id = await getStripeCustomerId(db.doc(PARENT_PATH).as(), "ada@example.com");

    expect(id).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(db.read(PARENTS, "ada@example.com")).toMatchObject({
      firstName: "Ada",
      stripeCustomerId: "cus_new",
    });
  });

  it("uses the production Stripe client by default and the test client for test data", async () => {
    await getStripeCustomerId(undefined, "ada@example.com");
    expect(mockGetStripe).toHaveBeenLastCalledWith(true);

    await getStripeCustomerId(undefined, "ada@example.com", true);
    expect(mockGetStripe).toHaveBeenLastCalledWith(false);
  });
});
