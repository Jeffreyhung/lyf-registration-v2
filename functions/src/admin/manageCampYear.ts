import {FieldValue, Firestore, Transaction} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  CAMP_YEAR_DATE_KEYS,
  ManageCampYearRequest,
  ManageCampYearResponse,
  normalizeEmail,
  registrationBypassCollectionPath,
  registrationBypassDocPath,
  SITE_CONFIG_PATH,
} from "lyf-registration-schemas";

import {getFirestoreDb, PROD_DATABASE_ID, TEST_DATABASE_ID} from "../utils";
import {adminCallableOptions, assertAdmin} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";
import {
  assertDateOrder,
  CampYearDoc,
  parseConfigInput,
  parseYear,
  shiftTimestamps,
} from "./campYearConfig";


/**
 * The only write path for camps/{year} configuration and config/site.
 * Firestore rules deny every client write to both, so this is where we can:
 *  - restrict edits to the configuration whitelist (never remainingSpots,
 *    which the registration functions own)
 *  - keep registration dates in a sensible order
 *  - roll a year forward by copying the previous one
 *  - keep the registration-close bypass emails OFF the public camp document,
 *    as one private document per email under camps/{year}/private/bypass
 *  - mirror a year or the site pointers from production into the test
 *    database (test mode only; production is never written by a copy)
 *  - append an entry to `adminAuditLog`
 *
 * Unlike the admin roster, camp data exists in both the prod and test
 * databases, so the request's `isTestData` picks which one is written.
 */
export const manageCampYear = onCall<
  ManageCampYearRequest,
  Promise<ManageCampYearResponse>
>(
  adminCallableOptions,
  withSentryCallable("manageCampYear", async (request) => {
    const {email: actorEmail} = await assertAdmin(request, "manageCampYear");
    const actor = normalizeEmail(actorEmail);

    const data = request.data ?? ({} as ManageCampYearRequest);
    const isTestData = data.isTestData === true;
    const db = getFirestoreDb(!isTestData);
    const database = isTestData ? TEST_DATABASE_ID : PROD_DATABASE_ID;

    // The copy actions read production and write the test database. They
    // are refused in production mode so there is no path that writes prod
    // from a copy, and the reads happen up front because a transaction
    // cannot span two databases.
    const isCopy =
      data.action === "copyYearFromProd" ||
      data.action === "copySiteConfigFromProd";
    if (isCopy && !isTestData) {
      throw new HttpsError(
        "failed-precondition",
        "Copying from production is only available in test mode"
      );
    }
    const prodDb = getFirestoreDb(true);
    let prodCamp: CampYearDoc | null = null;
    let prodBypass: string[] = [];
    let prodSite: CampYearDoc | null = null;
    if (data.action === "copyYearFromProd") {
      const year = parseYear(data.year, "year");
      const snap = await prodDb.collection("camps").doc(String(year)).get();
      if (!snap.exists) {
        throw new HttpsError(
          "not-found",
          `camps/${year} does not exist in production`
        );
      }
      prodCamp = snap.data() as CampYearDoc;
      const entries = await prodDb
        .collection(registrationBypassCollectionPath(year))
        .listDocuments();
      prodBypass = entries.map((d) => d.id).sort();
    } else if (data.action === "copySiteConfigFromProd") {
      const snap = await prodDb.doc(SITE_CONFIG_PATH).get();
      if (!snap.exists) {
        throw new HttpsError(
          "not-found",
          `${SITE_CONFIG_PATH} does not exist in production`
        );
      }
      prodSite = snap.data() as CampYearDoc;
    }

    let target = "";

    await db.runTransaction(async (tx) => {
      const audit = (
        action: ManageCampYearRequest["action"],
        before: CampYearDoc | null,
        after: CampYearDoc | null
      ) => {
        tx.set(db.collection("adminAuditLog").doc(), {
          actor,
          action,
          target,
          database,
          before,
          after,
          at: FieldValue.serverTimestamp(),
        });
      };

      switch (data.action) {
        case "createYear": {
          const year = parseYear(data.year, "year");
          const sourceYear = parseYear(data.sourceYear, "sourceYear");
          if (sourceYear >= year) {
            throw new HttpsError(
              "invalid-argument",
              "sourceYear must be earlier than year"
            );
          }
          target = `camps/${year}`;

          const targetRef = db.collection("camps").doc(String(year));
          const sourceRef = db.collection("camps").doc(String(sourceYear));
          const [targetSnap, sourceSnap] = await Promise.all([
            tx.get(targetRef),
            tx.get(sourceRef),
          ]);
          if (targetSnap.exists) {
            throw new HttpsError("already-exists", `${target} already exists`);
          }
          if (!sourceSnap.exists) {
            throw new HttpsError(
              "not-found",
              `camps/${sourceYear} does not exist to copy from`
            );
          }

          // Stale entries can linger if a year was deleted by hand; read them
          // (all reads must precede writes in a transaction).
          const bypassBefore = await readBypass(tx, db, year);

          const source = sourceSnap.data() as CampYearDoc;
          const shifted = shiftTimestamps(source, year - sourceYear);
          // Never copy a legacy bypass field onto the public document.
          delete shifted.registrationBypassEmails;
          // Each camp year has its own Mailchimp audience; copying last
          // year's id would quietly file the new year's parents there.
          // Left unset, registrations use the general list and remind the
          // directors to configure it.
          delete shifted.mailchimpListId;
          const {registrationBypassEmails: bypass, ...overrides} =
            parseConfigInput(data.overrides ?? {});
          const after: CampYearDoc = {
            ...shifted,
            ...overrides,
            name: overrides.name ?? `LYF Camp ${year}`,
            // Fresh year, fresh spots. campSizeCaps may itself be overridden.
            remainingSpots: {...((overrides.campSizeCaps ??
              shifted.campSizeCaps ??
              {}) as Record<string, number>)},
          };
          assertDateOrder(after, new Set(CAMP_YEAR_DATE_KEYS));

          tx.set(targetRef, after);
          // A new year starts with an empty bypass list unless overridden.
          const bypassAfter = writeBypass(
            tx, db, year, (bypass as string[] | undefined) ?? [], bypassBefore, actor
          );
          audit("createYear", null, {...after, registrationBypassEmails: bypassAfter});
          break;
        }

        case "updateYear": {
          const year = parseYear(data.year, "year");
          target = `camps/${year}`;
          const {registrationBypassEmails: bypass, ...fields} =
            parseConfigInput(data.fields);
          const changedKeys = Object.keys(fields);
          if (changedKeys.length === 0 && bypass === undefined) {
            throw new HttpsError("invalid-argument", "No fields to update");
          }

          const ref = db.collection("camps").doc(String(year));
          const snap = await tx.get(ref);
          if (!snap.exists) {
            throw new HttpsError("not-found", `${target} does not exist`);
          }
          const bypassBefore = await readBypass(tx, db, year);
          const before = snap.data() as CampYearDoc;
          const after: CampYearDoc = {...before, ...fields};
          assertDateOrder(after, new Set(changedKeys));

          if (changedKeys.length > 0) {
            tx.update(ref, fields as {[key: string]: FieldValue | object});
          }
          const bypassAfter = bypass === undefined ?
            bypassBefore :
            writeBypass(tx, db, year, bypass as string[], bypassBefore, actor);
          audit(
            "updateYear",
            {...before, registrationBypassEmails: bypassBefore},
            {...after, registrationBypassEmails: bypassAfter}
          );
          break;
        }

        case "setSiteConfig": {
          target = SITE_CONFIG_PATH;
          const config = data.config ?? {};
          const update: Record<string, number> = {};
          if (config.currentCampYear !== undefined) {
            update.currentCampYear = parseYear(
              config.currentCampYear,
              "currentCampYear"
            );
          }
          if (config.preRegistrationCampYear !== undefined) {
            update.preRegistrationCampYear = parseYear(
              config.preRegistrationCampYear,
              "preRegistrationCampYear"
            );
          }
          if (Object.keys(update).length === 0) {
            throw new HttpsError("invalid-argument", "No config to update");
          }

          const ref = db.doc(SITE_CONFIG_PATH);
          const snap = await tx.get(ref);
          const before = snap.exists ? (snap.data() as CampYearDoc) : null;

          // The pointers must name years that exist, otherwise the website
          // would gate itself closed with "camp not found".
          for (const year of Object.values(update)) {
            const campSnap = await tx.get(
              db.collection("camps").doc(String(year))
            );
            if (!campSnap.exists) {
              throw new HttpsError(
                "failed-precondition",
                `camps/${year} does not exist — create it before pointing ` +
                  "the site at it"
              );
            }
          }

          const after: CampYearDoc = {
            ...(before ?? {}),
            ...update,
            updatedBy: actor,
          };
          tx.set(
            ref,
            {...update, updatedBy: actor, updatedAt: FieldValue.serverTimestamp()},
            {merge: true}
          );
          audit("setSiteConfig", before, after);
          break;
        }

        case "copyYearFromProd": {
          const year = parseYear(data.year, "year");
          target = `camps/${year}`;
          const ref = db.collection("camps").doc(String(year));
          const snap = await tx.get(ref);
          const bypassBefore = await readBypass(tx, db, year);
          const before = snap.exists ? (snap.data() as CampYearDoc) : null;

          // Full replace so the test year is an exact mirror, remainingSpots
          // included; a legacy bypass field on the prod doc is still dropped.
          const after: CampYearDoc = {...(prodCamp as CampYearDoc)};
          delete after.registrationBypassEmails;
          tx.set(ref, after);
          const bypassAfter = writeBypass(tx, db, year, prodBypass, bypassBefore, actor);
          audit(
            "copyYearFromProd",
            before && {...before, registrationBypassEmails: bypassBefore},
            {...after, registrationBypassEmails: bypassAfter}
          );
          break;
        }

        case "copySiteConfigFromProd": {
          target = SITE_CONFIG_PATH;
          const update: Record<string, number> = {};
          for (const key of ["currentCampYear", "preRegistrationCampYear"] as const) {
            const value = (prodSite as CampYearDoc)[key];
            if (value !== undefined) update[key] = parseYear(value, key);
          }
          if (Object.keys(update).length === 0) {
            throw new HttpsError(
              "failed-precondition",
              `${SITE_CONFIG_PATH} in production has no year pointers`
            );
          }

          const ref = db.doc(SITE_CONFIG_PATH);
          const snap = await tx.get(ref);
          const before = snap.exists ? (snap.data() as CampYearDoc) : null;
          for (const year of Object.values(update)) {
            const campSnap = await tx.get(
              db.collection("camps").doc(String(year))
            );
            if (!campSnap.exists) {
              throw new HttpsError(
                "failed-precondition",
                `camps/${year} does not exist in the test database — copy it ` +
                  "from production first"
              );
            }
          }

          const after: CampYearDoc = {
            ...(before ?? {}),
            ...update,
            updatedBy: actor,
          };
          tx.set(
            ref,
            {...update, updatedBy: actor, updatedAt: FieldValue.serverTimestamp()},
            {merge: true}
          );
          audit("copySiteConfigFromProd", before, after);
          break;
        }

        default:
          throw new HttpsError(
            "invalid-argument",
            `Unknown action: ${(data as {action?: unknown}).action}`
          );
      }
    });

    logger.info(`manageCampYear: ${actor} ${data.action} ${target} (${database})`);
    return {status: "success", action: data.action, target};
  })
);

// ---- Bypass list (camps/{year}/private/bypass/emails/{email}) ----

/** Current bypass emails for a year, sorted. Must run before any tx write. */
async function readBypass(
  tx: Transaction,
  db: Firestore,
  year: number
): Promise<string[]> {
  const snap = await tx.get(db.collection(registrationBypassCollectionPath(year)));
  return snap.docs.map((d) => d.id).sort();
}

/**
 * Reconciles the per-email documents with `desired`: removes entries that
 * are no longer wanted, adds new ones stamped with the actor. Returns the
 * resulting list, sorted, for the audit log.
 */
function writeBypass(
  tx: Transaction,
  db: Firestore,
  year: number,
  desired: string[],
  existing: string[],
  actor: string
): string[] {
  const want = new Set(desired);
  const have = new Set(existing);
  for (const email of existing) {
    if (!want.has(email)) {
      tx.delete(db.doc(registrationBypassDocPath(year, email)));
    }
  }
  for (const email of desired) {
    if (!have.has(email)) {
      tx.set(db.doc(registrationBypassDocPath(year, email)), {
        email,
        addedBy: actor,
        addedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  return [...want].sort();
}
