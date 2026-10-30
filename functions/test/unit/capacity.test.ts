import {CampTrack, RegistrationStatus} from "lyf-registration-schemas";

import {
  AdmissionCandidate,
  applySpotDelta,
  decideAdmissions,
  shouldReleaseHold,
} from "../../src/registrationUtils/capacity";

const {YOUNGER, OLDER} = CampTrack;
const {
  ACTIVE,
  CANCELLED,
  WAITLIST,
  PENDING_PAYMENT,
  PARTIAL_PAYMENT,
  PROCESSING_PAYMENT,
} = RegistrationStatus;

function candidate(
  key: string,
  campTrack: CampTrack,
  extra: Partial<AdmissionCandidate> = {}
): AdmissionCandidate {
  return {key, campTrack, ...extra};
}

describe("applySpotDelta", () => {
  it("adds to an existing track and leaves the others alone", () => {
    expect(applySpotDelta({Younger: 3, Older: 2}, YOUNGER, -1)).toEqual({
      Younger: 2,
      Older: 2,
    });
  });

  it("floors at zero", () => {
    expect(applySpotDelta({Younger: 1, Older: 0}, YOUNGER, -3)).toEqual({
      Younger: 0,
      Older: 0,
    });
    expect(applySpotDelta({Younger: 0, Older: 0}, OLDER, -1)).toEqual({
      Younger: 0,
      Older: 0,
    });
  });

  it("treats a missing map or track as zero", () => {
    expect(applySpotDelta(undefined, OLDER, 1)).toEqual({Older: 1});
    expect(applySpotDelta({Younger: 2}, OLDER, -1)).toEqual({Younger: 2, Older: 0});
  });

  it("does not mutate its input", () => {
    const input = {Younger: 3, Older: 2};
    applySpotDelta(input, YOUNGER, -1);
    expect(input).toEqual({Younger: 3, Older: 2});
  });
});

describe("decideAdmissions", () => {
  describe("new registrations", () => {
    it("admits a camper when the track has room and reserves the spot", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER)],
        {Younger: 5, Older: 5},
        false
      );

      expect(result.decisions).toEqual([
        {
          key: "a",
          campTrack: YOUNGER,
          status: PENDING_PAYMENT,
          spotReserved: true,
          isWaitlisted: false,
          admittedNow: true,
        },
      ]);
      expect(result.remainingSpots).toEqual({Younger: 4, Older: 5});
      expect(result.admittedByTrack).toEqual({Younger: 1});
      expect(result.changed).toBe(true);
    });

    it("waitlists a camper when the track is full and reserves nothing", () => {
      const result = decideAdmissions(
        [candidate("a", OLDER)],
        {Younger: 5, Older: 0},
        false
      );

      expect(result.decisions[0]).toMatchObject({
        status: WAITLIST,
        spotReserved: false,
        isWaitlisted: true,
        admittedNow: false,
      });
      expect(result.remainingSpots).toEqual({Younger: 5, Older: 0});
      expect(result.changed).toBe(false);
    });

    it("waitlists everyone when the camp has no remaining-spots map", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER), candidate("b", OLDER)],
        undefined,
        false
      );

      expect(result.decisions.map((d) => d.status)).toEqual([WAITLIST, WAITLIST]);
      expect(result.remainingSpots).toEqual({});
      expect(result.changed).toBe(false);
    });

    it("waitlists a camper whose track is missing from the map", () => {
      const result = decideAdmissions(
        [candidate("a", OLDER)],
        {Younger: 5},
        false
      );

      expect(result.decisions[0].status).toBe(WAITLIST);
      expect(result.remainingSpots).toEqual({Younger: 5});
    });

    it("treats a negative count as full", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER)],
        {Younger: -2, Older: 1},
        false
      );

      expect(result.decisions[0].status).toBe(WAITLIST);
    });
  });

  describe("sibling policy", () => {
    it("admits both siblings when one spot is left and floors the track at 0", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER), candidate("b", YOUNGER)],
        {Younger: 1, Older: 3},
        false
      );

      expect(result.decisions.map((d) => d.status)).toEqual([
        PENDING_PAYMENT,
        PENDING_PAYMENT,
      ]);
      expect(result.decisions.every((d) => d.spotReserved === true)).toBe(true);
      expect(result.remainingSpots).toEqual({Younger: 0, Older: 3});
      expect(result.admittedByTrack).toEqual({Younger: 2});
      expect(result.changed).toBe(true);
    });

    it("admits three siblings against one spot (compared to the starting count, not a running total)", () => {
      const result = decideAdmissions(
        [candidate("a", OLDER), candidate("b", OLDER), candidate("c", OLDER)],
        {Younger: 0, Older: 1},
        false
      );

      expect(result.decisions.every((d) => d.status === PENDING_PAYMENT)).toBe(true);
      expect(result.remainingSpots).toEqual({Younger: 0, Older: 0});
    });

    it("decrements by the exact number admitted when there is plenty of room", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER), candidate("b", YOUNGER), candidate("c", YOUNGER)],
        {Younger: 10, Older: 10},
        false
      );

      expect(result.remainingSpots).toEqual({Younger: 7, Older: 10});
    });
  });

  describe("mixed tracks", () => {
    it("decides each sibling against their own track", () => {
      const result = decideAdmissions(
        [candidate("young", YOUNGER), candidate("old", OLDER)],
        {Younger: 2, Older: 0},
        false
      );

      expect(result.decisions).toEqual([
        expect.objectContaining({key: "young", status: PENDING_PAYMENT, spotReserved: true}),
        expect.objectContaining({key: "old", status: WAITLIST, spotReserved: false}),
      ]);
      expect(result.remainingSpots).toEqual({Younger: 1, Older: 0});
      expect(result.admittedByTrack).toEqual({Younger: 1});
    });

    it("decrements both tracks when siblings in different tracks are admitted", () => {
      const result = decideAdmissions(
        [candidate("young", YOUNGER), candidate("old", OLDER)],
        {Younger: 1, Older: 1},
        false
      );

      expect(result.remainingSpots).toEqual({Younger: 0, Older: 0});
      expect(result.admittedByTrack).toEqual({Younger: 1, Older: 1});
    });
  });

  describe("forceWaitlist", () => {
    it("waitlists a new camper even when there is room, without touching the count", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER)],
        {Younger: 5, Older: 5},
        true
      );

      expect(result.decisions[0]).toMatchObject({
        status: WAITLIST,
        spotReserved: false,
        isWaitlisted: true,
      });
      expect(result.remainingSpots).toEqual({Younger: 5, Older: 5});
      expect(result.changed).toBe(false);
    });

    it("does not override settled statuses or an existing reservation", () => {
      const result = decideAdmissions(
        [
          candidate("active", YOUNGER, {existingStatus: ACTIVE}),
          candidate("held", YOUNGER, {
            existingStatus: PENDING_PAYMENT,
            existingSpotReserved: true,
          }),
          candidate("new", YOUNGER),
        ],
        {Younger: 5, Older: 5},
        true
      );

      expect(result.decisions.map((d) => d.status)).toEqual([
        ACTIVE,
        PENDING_PAYMENT,
        WAITLIST,
      ]);
      expect(result.changed).toBe(false);
    });
  });

  describe("existing statuses", () => {
    it.each([ACTIVE, PROCESSING_PAYMENT, PARTIAL_PAYMENT])(
      "keeps %s and leaves spotReserved alone, with no decrement",
      (status) => {
        const result = decideAdmissions(
          [candidate("a", YOUNGER, {existingStatus: status, existingSpotReserved: false})],
          {Younger: 1, Older: 1},
          false
        );

        expect(result.decisions[0]).toEqual({
          key: "a",
          campTrack: YOUNGER,
          status,
          spotReserved: undefined,
          isWaitlisted: false,
          admittedNow: false,
        });
        expect(result.remainingSpots).toEqual({Younger: 1, Older: 1});
        expect(result.changed).toBe(false);
      }
    );

    it("keeps PENDING_PAYMENT with an existing reservation and does not decrement again", () => {
      const result = decideAdmissions(
        [
          candidate("a", OLDER, {
            existingStatus: PENDING_PAYMENT,
            existingSpotReserved: true,
          }),
        ],
        {Younger: 0, Older: 0},
        false
      );

      expect(result.decisions[0]).toMatchObject({
        status: PENDING_PAYMENT,
        spotReserved: true,
        isWaitlisted: false,
        admittedNow: false,
      });
      expect(result.remainingSpots).toEqual({Younger: 0, Older: 0});
      expect(result.changed).toBe(false);
    });

    it("re-evaluates PENDING_PAYMENT without a reservation (e.g. after an expired checkout): admits when there is room", () => {
      const result = decideAdmissions(
        [candidate("a", OLDER, {existingStatus: PENDING_PAYMENT, existingSpotReserved: false})],
        {Younger: 0, Older: 1},
        false
      );

      expect(result.decisions[0]).toMatchObject({
        status: PENDING_PAYMENT,
        spotReserved: true,
        admittedNow: true,
      });
      expect(result.remainingSpots).toEqual({Younger: 0, Older: 0});
    });

    it("re-evaluates PENDING_PAYMENT without a reservation: waitlists when full", () => {
      const result = decideAdmissions(
        [candidate("a", OLDER, {existingStatus: PENDING_PAYMENT})],
        {Younger: 0, Older: 0},
        false
      );

      expect(result.decisions[0]).toMatchObject({status: WAITLIST, spotReserved: false});
    });

    it.each([WAITLIST, CANCELLED])(
      "re-evaluates a %s registration against capacity",
      (status) => {
        const admitted = decideAdmissions(
          [candidate("a", YOUNGER, {existingStatus: status})],
          {Younger: 1, Older: 0},
          false
        );
        const waitlisted = decideAdmissions(
          [candidate("a", YOUNGER, {existingStatus: status})],
          {Younger: 0, Older: 0},
          false
        );

        expect(admitted.decisions[0]).toMatchObject({
          status: PENDING_PAYMENT,
          spotReserved: true,
        });
        expect(admitted.remainingSpots).toEqual({Younger: 0, Older: 0});
        expect(waitlisted.decisions[0]).toMatchObject({
          status: WAITLIST,
          spotReserved: false,
        });
      }
    );

    it("ignores a stale spotReserved on a WAITLIST registration", () => {
      const result = decideAdmissions(
        [candidate("a", YOUNGER, {existingStatus: WAITLIST, existingSpotReserved: true})],
        {Younger: 0, Older: 0},
        false
      );

      expect(result.decisions[0]).toMatchObject({status: WAITLIST, spotReserved: false});
    });

    it("only decrements for the campers admitted in this request", () => {
      const result = decideAdmissions(
        [
          candidate("active", YOUNGER, {existingStatus: ACTIVE}),
          candidate("held", YOUNGER, {
            existingStatus: PENDING_PAYMENT,
            existingSpotReserved: true,
          }),
          candidate("new", YOUNGER),
          candidate("full", OLDER),
        ],
        {Younger: 1, Older: 0},
        false
      );

      expect(result.decisions.map((d) => d.status)).toEqual([
        ACTIVE,
        PENDING_PAYMENT,
        PENDING_PAYMENT,
        WAITLIST,
      ]);
      expect(result.admittedByTrack).toEqual({Younger: 1});
      expect(result.remainingSpots).toEqual({Younger: 0, Older: 0});
    });
  });

  it("returns decisions in input order with the caller's keys", () => {
    const result = decideAdmissions(
      [candidate("z", OLDER), candidate("a", YOUNGER)],
      {Younger: 1, Older: 1},
      false
    );

    expect(result.decisions.map((d) => d.key)).toEqual(["z", "a"]);
  });

  it("handles an empty request", () => {
    const result = decideAdmissions([], {Younger: 1, Older: 1}, false);

    expect(result.decisions).toEqual([]);
    expect(result.remainingSpots).toEqual({Younger: 1, Older: 1});
    expect(result.changed).toBe(false);
  });

  it("does not mutate the input map", () => {
    const input = {Younger: 1, Older: 1};
    decideAdmissions([candidate("a", YOUNGER)], input, false);
    expect(input).toEqual({Younger: 1, Older: 1});
  });
});

describe("shouldReleaseHold", () => {
  it("releases a pending registration that holds a spot", () => {
    expect(shouldReleaseHold({status: PENDING_PAYMENT, spotReserved: true})).toBe(true);
  });

  it("does not release a pending registration without a hold", () => {
    expect(shouldReleaseHold({status: PENDING_PAYMENT, spotReserved: false})).toBe(false);
    expect(shouldReleaseHold({status: PENDING_PAYMENT})).toBe(false);
  });

  it.each([ACTIVE, PROCESSING_PAYMENT, PARTIAL_PAYMENT, WAITLIST, CANCELLED])(
    "does not release a %s registration even if spotReserved is set",
    (status) => {
      expect(shouldReleaseHold({status, spotReserved: true})).toBe(false);
    }
  );

  it("does not release a missing registration", () => {
    expect(shouldReleaseHold(undefined)).toBe(false);
    expect(shouldReleaseHold({})).toBe(false);
  });
});
