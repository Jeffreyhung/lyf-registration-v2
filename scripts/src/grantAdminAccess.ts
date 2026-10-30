/**
 * Bootstrap (or repair) an admin entry directly with the Admin SDK.
 *
 * Day-to-day roster changes should go through the Admin Management tab, which
 * calls the `manageAdmin` function (last-full_admin guard + audit log). This
 * script exists for the chicken-and-egg case — creating the very first
 * full_admin — and for recovering from a lockout.
 *
 * Usage:
 *   ADMIN_EMAIL=someone@tacl.org ./run.sh -n grantAdminAccess
 *   ADMIN_EMAIL=someone@tacl.org ADMIN_ROLE=health_staff ./run.sh -n grantAdminAccess
 */
import * as admin from "firebase-admin"
import {getFirestore} from "firebase-admin/firestore"

const VALID_ROLES = [
  "full_admin",
  "program_admin",
  "program_staff",
  "health_staff",
]

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2")

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()
  const role = process.env.ADMIN_ROLE ?? "full_admin"

  if (!email.includes("@")) {
    throw new Error("Set ADMIN_EMAIL to the admin's sign-in email")
  }
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`ADMIN_ROLE must be one of: ${VALID_ROLES.join(", ")}`)
  }

  const ref = db.collection("admins").doc(email)
  const existing = await ref.get()

  await ref.set(
    {
      role,
      disabled: false,
      addedBy: "grantAdminAccess script",
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true}
  )

  await db.collection("adminAuditLog").add({
    actor: "grantAdminAccess script",
    action: existing.exists ? "setRole" : "add",
    target: email,
    before: existing.exists ? existing.data() : null,
    after: {role, disabled: false},
    at: admin.firestore.FieldValue.serverTimestamp(),
  })

  console.log(
    `${existing.exists ? "Updated" : "Created"} admins/${email} with role ${role}`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
