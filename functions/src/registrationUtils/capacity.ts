import {
  CampRemainingSpots,
  CampTrack,
  Registration,
  RegistrationStatus,
} from "lyf-registration-schemas";

/**
 * Pure capacity bookkeeping for registrations. Nothing in here touches
 * Firestore so the rules can be unit-tested exhaustively; the callers
 * (createOrUpdateRegistration, completeRegistration, moveCampersOffWaitlist,
 * releaseRegistrationHolds) run these inside a transaction.
 */

/** The remaining-spots map as stored on the camp year document. */
export type RemainingSpotsMap = Partial<CampRemainingSpots>;

export type AdmissionCandidate = {
  /** Opaque identifier the caller uses to match decisions back to campers. */
  key: string;
  campTrack: CampTrack;
  /** Status currently on the registration document, if it has one. */
  existingStatus?: RegistrationStatus | null;
  /** Whether the registration already holds a spot (see Registration.spotReserved). */
  existingSpotReserved?: boolean | null;
};

export type AdmissionDecision = {
  key: string;
  campTrack: CampTrack;
  status: RegistrationStatus;
  /**
   * The value to write for `spotReserved`, or `undefined` when the existing
   * value must be left alone (statuses that are already past the hold stage).
   */
  spotReserved: boolean | undefined;
  isWaitlisted: boolean;
  /** True when this decision took a spot out of `remainingSpots`. */
  admittedNow: boolean;
};

export type AdmissionResult = {
  decisions: AdmissionDecision[];
  /** `remainingSpots` after subtracting the newly admitted campers (floored at 0). */
  remainingSpots: RemainingSpotsMap;
  /** Newly admitted campers per track; empty when nothing was reserved. */
  admittedByTrack: Partial<Record<CampTrack, number>>;
  /** Whether `remainingSpots` differs from the input and needs to be written. */
  changed: boolean;
};

// Statuses that are already past the hold stage: the registration has been
// paid for (or is being paid for), so re-submitting the form must neither
// re-evaluate it against capacity nor change its reservation flag.
const SETTLED_STATUSES: ReadonlySet<RegistrationStatus> = new Set([
  RegistrationStatus.ACTIVE,
  RegistrationStatus.PROCESSING_PAYMENT,
  RegistrationStatus.PARTIAL_PAYMENT,
]);

/**
 * Add `delta` spots to one track, never letting the count drop below zero.
 * Tracks missing from the map count as zero.
 */
export function applySpotDelta(
  remainingSpots: RemainingSpotsMap | undefined,
  campTrack: CampTrack,
  delta: number
): RemainingSpotsMap {
  const current = remainingSpots?.[campTrack] ?? 0;
  return {
    ...(remainingSpots ?? {}),
    [campTrack]: Math.max(0, current + delta),
  };
}

/**
 * Decide, for every camper in one registration request, whether they get a
 * spot (PENDING_PAYMENT + spotReserved) or go on the waitlist, and compute the
 * new remaining-spots map in the same step so the caller can commit both in a
 * single transaction.
 *
 * Rules, per camper:
 *   1. ACTIVE / PROCESSING_PAYMENT / PARTIAL_PAYMENT: keep the status, do not
 *      touch `spotReserved`.
 *   2. PENDING_PAYMENT with `spotReserved === true` (a prior reservation, or an
 *      admin moved them off the waitlist): keep PENDING_PAYMENT, no decrement.
 *   3. Otherwise (new, WAITLIST, CANCELLED, or PENDING_PAYMENT without a
 *      reservation): `forceWaitlist` → WAITLIST; else admitted when the track
 *      had at least one spot *at the start of the request*.
 *
 * Sibling policy: every camper is compared against the count as it was at the
 * start, not against a running total, so two siblings both get in when a
 * single spot is left (we would rather be one over than split a family). The
 * track is then decremented by the number admitted, flooring at zero.
 *
 * @param candidates One entry per camper in the request.
 * @param remainingSpots The camp year's remaining-spots map as read in the
 *   transaction; a missing map or track counts as zero spots.
 * @param forceWaitlist Staff flag that waitlists everyone regardless of capacity.
 */
export function decideAdmissions(
  candidates: AdmissionCandidate[],
  remainingSpots: RemainingSpotsMap | undefined,
  forceWaitlist: boolean
): AdmissionResult {
  const startingSpots: RemainingSpotsMap = {...(remainingSpots ?? {})};
  const admittedByTrack: Partial<Record<CampTrack, number>> = {};

  const decisions = candidates.map<AdmissionDecision>((candidate) => {
    const {key, campTrack, existingStatus, existingSpotReserved} = candidate;

    if (existingStatus && SETTLED_STATUSES.has(existingStatus)) {
      return {
        key,
        campTrack,
        status: existingStatus,
        spotReserved: undefined,
        isWaitlisted: false,
        admittedNow: false,
      };
    }

    if (
      existingStatus === RegistrationStatus.PENDING_PAYMENT &&
      existingSpotReserved === true
    ) {
      return {
        key,
        campTrack,
        status: RegistrationStatus.PENDING_PAYMENT,
        spotReserved: true,
        isWaitlisted: false,
        admittedNow: false,
      };
    }

    const hasRoom = (startingSpots[campTrack] ?? 0) > 0;
    if (forceWaitlist || !hasRoom) {
      return {
        key,
        campTrack,
        status: RegistrationStatus.WAITLIST,
        spotReserved: false,
        isWaitlisted: true,
        admittedNow: false,
      };
    }

    admittedByTrack[campTrack] = (admittedByTrack[campTrack] ?? 0) + 1;
    return {
      key,
      campTrack,
      status: RegistrationStatus.PENDING_PAYMENT,
      spotReserved: true,
      isWaitlisted: false,
      admittedNow: true,
    };
  });

  let newRemaining = startingSpots;
  (Object.keys(admittedByTrack) as CampTrack[]).forEach((track) => {
    newRemaining = applySpotDelta(newRemaining, track, -admittedByTrack[track]!);
  });

  return {
    decisions,
    remainingSpots: newRemaining,
    admittedByTrack,
    changed: Object.keys(admittedByTrack).length > 0,
  };
}

/**
 * Whether an expired checkout session should hand this registration's spot
 * back: only a hold that is still waiting for payment is released. Anything
 * already paid (or paying) keeps its spot, and a registration that never held
 * one has nothing to give back.
 */
export function shouldReleaseHold(
  registration: Pick<Registration, "status" | "spotReserved"> | undefined
): boolean {
  return (
    registration?.status === RegistrationStatus.PENDING_PAYMENT &&
    registration?.spotReserved === true
  );
}
