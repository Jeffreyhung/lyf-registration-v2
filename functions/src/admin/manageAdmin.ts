import {FieldValue} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {
  Admin,
  ManageAdminRequest,
  ManageAdminResponse,
  normalizeEmail,
  resolveAdminRole,
} from "lyf-registration-schemas";

import {db} from "../utils";
import {assertAdmin, callableOptions} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";

/**
 * The only write path for the admin roster. Firestore rules deny client
 * writes to `admins/`, so every change funnels through here where we can:
 *  - refuse to remove/demote/disable the last active full_admin (lockout)
 *  - refuse self-demotion/removal
 *  - append an entry to `adminAuditLog`
 *
 * The roster is written to the production database only — it is global, not
 * per test/prod data set. Security rules can only read the database they
 * guard, so `replicateAdminsToTest` mirrors every change into the test
 * database; nothing here (or anywhere else) should write there directly.
 */
export const manageAdmin = onCall<ManageAdminRequest, Promise<ManageAdminResponse>>(
  callableOptions,
  withSentryCallable("manageAdmin", async (request) => {
    const {email: actorEmail} = await assertAdmin(request, "manageAdmins");
    const actor = normalizeEmail(actorEmail);

    const {action} = request.data;
    const target = normalizeEmail(request.data.email ?? "");
    if (!target.includes("@")) {
      throw new HttpsError("invalid-argument", "A valid email is required");
    }
    const isSelf = target === actor;

    const adminsRef = db.collection("admins");
    const targetRef = adminsRef.doc(target);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(targetRef);
      const before = snap.exists ? (snap.data() as Admin) : null;

      const fullAdmins = await tx.get(adminsRef.where("role", "==", "full_admin"));
      const activeFullAdmins = fullAdmins.docs
        .filter((d) => d.data().disabled !== true)
        .map((d) => d.id);
      const targetIsLastFullAdmin =
        activeFullAdmins.includes(target) && activeFullAdmins.length <= 1;

      let after: Admin | null;

      switch (action) {
        case "add": {
          if (snap.exists) {
            throw new HttpsError("already-exists", `${target} is already an admin`);
          }
          const role = resolveAdminRole(request.data.role);
          if (!role) {
            throw new HttpsError("invalid-argument", "A valid role is required");
          }
          after = {role, addedBy: actor, disabled: false};
          tx.set(targetRef, {...after, addedAt: FieldValue.serverTimestamp()});
          break;
        }

        case "setRole": {
          if (!before) {
            throw new HttpsError("not-found", `${target} is not an admin`);
          }
          const role = resolveAdminRole(request.data.role);
          if (!role) {
            throw new HttpsError("invalid-argument", "A valid role is required");
          }
          if (isSelf) {
            throw new HttpsError(
              "failed-precondition",
              "You cannot change your own role"
            );
          }
          if (role !== "full_admin" && targetIsLastFullAdmin) {
            throw new HttpsError(
              "failed-precondition",
              "Cannot demote the last full admin"
            );
          }
          after = {...before, role};
          tx.update(targetRef, {role});
          break;
        }

        case "setDisabled": {
          if (!before) {
            throw new HttpsError("not-found", `${target} is not an admin`);
          }
          const disabled = request.data.disabled === true;
          if (isSelf) {
            throw new HttpsError(
              "failed-precondition",
              "You cannot disable your own account"
            );
          }
          if (disabled && targetIsLastFullAdmin) {
            throw new HttpsError(
              "failed-precondition",
              "Cannot disable the last full admin"
            );
          }
          after = {...before, disabled};
          tx.update(targetRef, {disabled});
          break;
        }

        case "remove": {
          if (!before) {
            throw new HttpsError("not-found", `${target} is not an admin`);
          }
          if (isSelf) {
            throw new HttpsError(
              "failed-precondition",
              "You cannot remove yourself as an admin"
            );
          }
          if (targetIsLastFullAdmin) {
            throw new HttpsError(
              "failed-precondition",
              "Cannot remove the last full admin"
            );
          }
          after = null;
          tx.delete(targetRef);
          break;
        }

        default:
          throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
      }

      tx.set(db.collection("adminAuditLog").doc(), {
        actor,
        action,
        target,
        before,
        after,
        at: FieldValue.serverTimestamp(),
      });
    });

    logger.info(`manageAdmin: ${actor} ${action} ${target}`);
    return {status: "success", action, email: target};
  })
);
