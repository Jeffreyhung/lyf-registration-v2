import {DocumentReference, getFirestore} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {
  FirestoreEvent,
  onDocumentUpdated,
  Change,
  QueryDocumentSnapshot,
} from "firebase-functions/v2/firestore";
import {
  Camper,
  Family,
  normalizeEmails,
  validateRegistrationWrite,
} from "lyf-registration-schemas";

import {PROD_DATABASE_ID, TEST_DATABASE_ID} from "../utils";
import {withSentryEvent} from "../utils/sentry";

// Firestore batches cap at 500 writes
const BATCH_SIZE = 400;

/**
 * `Registration.familyEmails` is denormalized from `Family.emails` so the
 * registrations rule can do an ownership check without an extra get(). This
 * trigger keeps every registration of every camper in the family in sync
 * whenever the membership list changes (across all camp years).
 */
async function syncFamilyEmails(
  databaseId: string,
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, {familyId: string}>
): Promise<void> {
  if (!event.data) return;

  const before = normalizeEmails((event.data.before.data() as Family).emails ?? []);
  const after = normalizeEmails((event.data.after.data() as Family).emails ?? []);
  const unchanged =
    before.length === after.length && before.every((e) => after.includes(e));
  if (unchanged) return;

  const db = getFirestore(databaseId);
  const {familyId} = event.params;

  const campers = await db.collection(`families/${familyId}/campers`).get();
  // The schemas package types refs with the client SDK; at runtime these are
  // admin SDK references from the same database.
  const registrationRefs = campers.docs.flatMap(
    (c) => ((c.data() as Camper).registrations ?? []) as unknown as DocumentReference[]
  );
  if (registrationRefs.length === 0) return;

  // Only touch registrations that still exist — a stale ref would fail the
  // whole batch.
  const existing = (await db.getAll(...registrationRefs)).filter((s) => s.exists);

  // The same patch goes on every registration, so validate it once up front.
  const update = validateRegistrationWrite({familyEmails: after});
  for (let i = 0; i < existing.length; i += BATCH_SIZE) {
    const batch = db.batch();
    existing
      .slice(i, i + BATCH_SIZE)
      .forEach((snap) => batch.update(snap.ref, {...update}));
    await batch.commit();
  }

  logger.info(
    `Synced familyEmails on ${existing.length} registrations for family ${familyId} (${databaseId})`
  );
}

export const syncFamilyEmailsOnUpdate = onDocumentUpdated(
  {document: "families/{familyId}", database: PROD_DATABASE_ID},
  withSentryEvent("syncFamilyEmailsOnUpdate", (event) =>
    syncFamilyEmails(PROD_DATABASE_ID, event)
  )
);

export const syncFamilyEmailsOnUpdateTest = onDocumentUpdated(
  {document: "families/{familyId}", database: TEST_DATABASE_ID},
  withSentryEvent("syncFamilyEmailsOnUpdateTest", (event) =>
    syncFamilyEmails(TEST_DATABASE_ID, event)
  )
);
