import Stripe from "stripe";
import {DocumentReference, FieldValue, Firestore} from "firebase-admin/firestore";
import {logger} from "firebase-functions";

import {
  CampTrack,
  CampYear,
  Registration,
  validateCampYearWrite,
  validateRegistrationWrite,
} from "lyf-registration-schemas";
import type {RegistrationLineItemMetadata} from "./createRegistrationSession";
import {
  applySpotDelta,
  RemainingSpotsMap,
  shouldReleaseHold,
} from "../registrationUtils/capacity";

/**
 * A registration checkout session expired without being paid: hand the spots
 * it was holding back to the camp year.
 *
 * For every registration line item, in one transaction: if the registration is
 * still PENDING_PAYMENT with `spotReserved === true`, increment
 * `remainingSpots[campTrack]` by one and clear `spotReserved`. The status is
 * left as PENDING_PAYMENT on purpose — the parent's next registration attempt
 * re-evaluates it against capacity (see decideAdmissions), and the website
 * already knows how to resume a pending registration. Registrations that were
 * paid in the meantime, or that never held a spot, are left untouched.
 *
 * @returns The number of registrations whose hold was released.
 */
export async function releaseRegistrationHolds(
  db: Firestore,
  checkoutSession: Stripe.Checkout.Session
): Promise<number> {
  const lineItems = checkoutSession.line_items?.data ?? [];

  let campYear = "";
  const trackByPath = new Map<string, CampTrack>();
  for (const item of lineItems) {
    const product = item.price?.product as Stripe.Product | undefined;
    const metadata = product?.metadata as RegistrationLineItemMetadata | undefined;
    if (!metadata?.registrationRef || !metadata.campYear) continue;
    trackByPath.set(metadata.registrationRef, metadata.campTrack as CampTrack);
    campYear = metadata.campYear;
  }

  if (trackByPath.size === 0) {
    logger.info(
      `Expired session ${checkoutSession.id} has no registration line items; nothing to release`
    );
    return 0;
  }

  const campRef = db.collection("camps").doc(campYear) as DocumentReference<CampYear>;
  const registrationRefs = [...trackByPath.keys()].map(
    (path) => db.doc(path) as DocumentReference<Registration>
  );

  const released = await db.runTransaction(async (t) => {
    const campSnap = await t.get(campRef);
    const regSnaps = await t.getAll(...registrationRefs);

    const releasable = regSnaps.filter(
      (snap) => snap.exists && shouldReleaseHold(snap.data())
    );
    if (releasable.length === 0) return 0;

    let remainingSpots: RemainingSpotsMap | undefined =
      campSnap.data()?.remainingSpots;
    releasable.forEach((snap) => {
      const track =
        snap.data()?.campTrack ?? trackByPath.get(snap.ref.path) ?? null;
      if (track) {
        remainingSpots = applySpotDelta(remainingSpots, track, 1);
      } else {
        logger.error(
          `Registration ${snap.ref.path} has no camp track; releasing its hold without a spot increment`
        );
      }
      t.update(
        snap.ref,
        validateRegistrationWrite({
          spotReserved: false,
          updatedAt: FieldValue.serverTimestamp(),
        })
      );
    });

    if (remainingSpots) {
      t.set(campRef, validateCampYearWrite({remainingSpots}), {merge: true});
    }
    return releasable.length;
  });

  logger.info(
    `Released ${released} registration hold(s) for expired session ${checkoutSession.id} (camp ${campYear})`
  );
  return released;
}
