import type Stripe from "stripe";
import type {Registration} from "lyf-registration-schemas";

import {releaseRegistrationHolds} from "../../src/registration/releaseRegistrationHolds";
import {FakeFirestore} from "./fakeFirestore";

const REGISTRATIONS = "camps/2026/registrations";

function lineItem(registrationRef: string, campTrack: string, campYear = "2026") {
  return {
    description: "LYF Camp 2026 Registration: Ada Lovelace",
    price: {
      product: {
        metadata: {
          familyRef: "families/fam",
          registrationRef,
          campYear,
          campTrack,
        },
      },
    },
  };
}

function session(items: ReturnType<typeof lineItem>[]): Stripe.Checkout.Session {
  return {
    id: "cs_test_expired",
    line_items: {data: items},
  } as unknown as Stripe.Checkout.Session;
}

function setup() {
  const db = new FakeFirestore().seed("camps", "2026", {
    remainingSpots: {Younger: 2, Older: 0},
  });
  return db;
}

describe("releaseRegistrationHolds", () => {
  it("returns a pending registration's held spot and clears the flag", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      status: "Pending Payment",
      spotReserved: true,
      campTrack: "Older",
    });

    const released = await releaseRegistrationHolds(
      db.as(),
      session([lineItem(`${REGISTRATIONS}/c1`, "Older")])
    );

    expect(released).toBe(1);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 1});
    const reg = db.read(REGISTRATIONS, "c1") as Registration;
    expect(reg.spotReserved).toBe(false);
    expect(reg.status).toBe("Pending Payment");
    expect(reg.updatedAt).toBeDefined();
  });

  it("releases every held registration in the session, per track", async () => {
    const db = setup()
      .seed(REGISTRATIONS, "c1", {status: "Pending Payment", spotReserved: true, campTrack: "Younger"})
      .seed(REGISTRATIONS, "c2", {status: "Pending Payment", spotReserved: true, campTrack: "Older"});

    const released = await releaseRegistrationHolds(
      db.as(),
      session([
        lineItem(`${REGISTRATIONS}/c1`, "Younger"),
        lineItem(`${REGISTRATIONS}/c2`, "Older"),
      ])
    );

    expect(released).toBe(2);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 1});
  });

  it("leaves a registration that was paid in the meantime alone", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      status: "Active",
      spotReserved: true,
      campTrack: "Older",
    });

    const released = await releaseRegistrationHolds(
      db.as(),
      session([lineItem(`${REGISTRATIONS}/c1`, "Older")])
    );

    expect(released).toBe(0);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
    expect((db.read(REGISTRATIONS, "c1") as Registration).spotReserved).toBe(true);
  });

  it("does not increment for a registration that never held a spot", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      status: "Pending Payment",
      spotReserved: false,
      campTrack: "Older",
    });

    const released = await releaseRegistrationHolds(
      db.as(),
      session([lineItem(`${REGISTRATIONS}/c1`, "Older")])
    );

    expect(released).toBe(0);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });

  it("is idempotent: a second delivery releases nothing more", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      status: "Pending Payment",
      spotReserved: true,
      campTrack: "Older",
    });
    const expired = session([lineItem(`${REGISTRATIONS}/c1`, "Older")]);

    await releaseRegistrationHolds(db.as(), expired);
    const second = await releaseRegistrationHolds(db.as(), expired);

    expect(second).toBe(0);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 1});
  });

  it("skips registrations that no longer exist", async () => {
    const db = setup();

    const released = await releaseRegistrationHolds(
      db.as(),
      session([lineItem(`${REGISTRATIONS}/gone`, "Older")])
    );

    expect(released).toBe(0);
    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 2, Older: 0});
  });

  it("falls back to the line item's track when the registration has none", async () => {
    const db = setup().seed(REGISTRATIONS, "c1", {
      status: "Pending Payment",
      spotReserved: true,
    });

    await releaseRegistrationHolds(
      db.as(),
      session([lineItem(`${REGISTRATIONS}/c1`, "Younger")])
    );

    expect(db.read("camps", "2026")?.remainingSpots).toEqual({Younger: 3, Older: 0});
  });

  it("ignores line items without registration metadata (e.g. the donation)", async () => {
    const db = setup();

    const released = await releaseRegistrationHolds(
      db.as(),
      session([
        {description: "Donation", price: {product: {metadata: {}}}} as ReturnType<typeof lineItem>,
      ])
    );

    expect(released).toBe(0);
  });
});
