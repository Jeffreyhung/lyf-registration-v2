import {logger} from "firebase-functions";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {PROD_DATABASE_ID, TEST_DATABASE_ID, testDb} from "../utils";
import {withSentryEvent} from "../utils/sentry";

/**
 * Mirrors the admin roster from the production database into the test
 * database.
 *
 * The roster has one source of truth — `admins/` in the production database,
 * written only by `manageAdmin` — and the client, the callables and the
 * security rules for production all read it from there. Security rules,
 * however, can only `get()` documents in the database being queried, so the
 * rules protecting the test database need their own copy of `admins/` or
 * every admin read in test mode is denied. Rather than teach each writer
 * about the second database, this trigger replays every create, update and
 * delete so the copy can never drift from the source.
 *
 * `set` without merge: the test copy is a replacement, so a field removed in
 * production disappears here too.
 */
export const replicateAdminsToTest = onDocumentWritten(
  {document: "admins/{email}", database: PROD_DATABASE_ID},
  withSentryEvent("replicateAdminsToTest", async (event) => {
    if (!event.data) return;

    const {email} = event.params;
    const mirror = testDb.collection("admins").doc(email);
    const after = event.data.after;

    if (!after.exists) {
      await mirror.delete();
      logger.info(`Removed admins/${email} from ${TEST_DATABASE_ID}`);
      return;
    }

    await mirror.set(after.data() ?? {});
    logger.info(`Mirrored admins/${email} into ${TEST_DATABASE_ID}`);
  })
);
