import {DocumentReference, getFirestore} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {
  FirestoreEvent,
  onDocumentUpdated,
  Change,
  QueryDocumentSnapshot,
} from "firebase-functions/v2/firestore";
import {Camper, validateRegistrationWrite} from "lyf-registration-schemas";

import {PROD_DATABASE_ID, TEST_DATABASE_ID} from "../utils";
import {withSentryEvent} from "../utils/sentry";
import {buildCamperProfileUpdate} from "./camperProfile";

// Firestore batches cap at 500 writes
const BATCH_SIZE = 400;

type CamperParams = {familyId: string; camperId: string};

/**
 * The admin grid reads camper profile fields (name, preferred name, birth
 * date, gender, pronouns) straight off the registration document (see
 * Registration schemaVersion 3). createOrUpdateRegistration writes them at
 * registration time; this trigger keeps them current when a parent later
 * edits the camper from their profile, across every camp year the camper has
 * a registration for. Health and demographics live under private/ and are
 * never mirrored (see camperProfile.ts).
 */
async function syncCamperProfile(
  databaseId: string,
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, CamperParams>
): Promise<void> {
  if (!event.data) return;

  const before = event.data.before.data() as Camper;
  const after = event.data.after.data() as Camper;
  const patch = buildCamperProfileUpdate(before, after);
  if (!patch) return;
  // The same patch goes on every registration, so validate it once up front.
  const update = validateRegistrationWrite(patch);

  // The schemas package types refs with the client SDK; at runtime these are
  // admin SDK references from the same database.
  const registrationRefs = (after.registrations ??
    []) as unknown as DocumentReference[];
  if (registrationRefs.length === 0) return;

  const db = getFirestore(databaseId);
  const {familyId, camperId} = event.params;

  // Only touch registrations that still exist — a stale ref would fail the
  // whole batch.
  const existing = (await db.getAll(...registrationRefs)).filter((s) => s.exists);

  for (let i = 0; i < existing.length; i += BATCH_SIZE) {
    const batch = db.batch();
    existing
      .slice(i, i + BATCH_SIZE)
      .forEach((snap) => batch.update(snap.ref, {...update}));
    await batch.commit();
  }

  logger.info(
    `Synced camper profile on ${existing.length} registrations for camper ` +
      `${familyId}/${camperId} (${databaseId})`
  );
}

const CAMPER_DOCUMENT = "families/{familyId}/campers/{camperId}";

export const syncCamperProfileOnUpdate = onDocumentUpdated(
  {document: CAMPER_DOCUMENT, database: PROD_DATABASE_ID},
  withSentryEvent("syncCamperProfileOnUpdate", (event) =>
    syncCamperProfile(PROD_DATABASE_ID, event)
  )
);

export const syncCamperProfileOnUpdateTest = onDocumentUpdated(
  {document: CAMPER_DOCUMENT, database: TEST_DATABASE_ID},
  withSentryEvent("syncCamperProfileOnUpdateTest", (event) =>
    syncCamperProfile(TEST_DATABASE_ID, event)
  )
);
