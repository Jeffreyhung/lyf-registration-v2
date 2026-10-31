/**
 * One-time migration script for RBAC restructure.
 *
 * This script:
 * 1. Copies medicalConditions and dietAndFoodAllergies from each camper doc
 *    into families/{familyId}/campers/{camperId}/private/health
 * 2. Copies demographics from each camper doc
 *    into families/{familyId}/campers/{camperId}/private/demographics
 * 3. Adds role: "full_admin" to all existing admin documents
 * 4. Normalizes family emails (and registration familyEmails) to lowercase so
 *    firestore.rules exact-match checks against request.auth.token.email work,
 *    and re-keys any admins/{email} docs whose ID isn't already lowercase
 *
 * Run with: ./run.sh -n migrateToRbac
 */
import * as admin from "firebase-admin"
import {getFirestore} from "firebase-admin/firestore"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2")

async function migrateCamperData() {
  const familiesSnapshot = await db.collection("families").get()
  let camperCount = 0
  let healthCount = 0
  let demographicsCount = 0

  for (const familyDoc of familiesSnapshot.docs) {
    const campersSnapshot = await familyDoc.ref.collection("campers").get()

    for (const camperDoc of campersSnapshot.docs) {
      const data = camperDoc.data()
      camperCount++

      // Migrate health fields to private/health sub-doc
      const healthData: Record<string, unknown> = {}
      if (data.medicalConditions !== undefined) {
        healthData.medicalConditions = data.medicalConditions
      }
      if (data.dietAndFoodAllergies !== undefined) {
        healthData.dietAndFoodAllergies = data.dietAndFoodAllergies
      }

      if (Object.keys(healthData).length > 0) {
        await camperDoc.ref
          .collection("private")
          .doc("health")
          .set(healthData, {merge: true})
        healthCount++
      }

      // Migrate demographics to private/demographics sub-doc
      if (data.demographics && Object.keys(data.demographics).length > 0) {
        await camperDoc.ref
          .collection("private")
          .doc("demographics")
          .set(data.demographics, {merge: true})
        demographicsCount++
      }
    }
  }

  console.log(`Processed ${camperCount} campers`)
  console.log(`  - Migrated ${healthCount} health sub-docs`)
  console.log(`  - Migrated ${demographicsCount} demographics sub-docs`)
}

async function migrateAdminRoles() {
  const adminsSnapshot = await db.collection("admins").get()
  let count = 0

  for (const adminDoc of adminsSnapshot.docs) {
    const data = adminDoc.data()
    if (!data.role) {
      await adminDoc.ref.update({role: "full_admin"})
      count++
    }
  }

  console.log(`Added role: "full_admin" to ${count} existing admin docs`)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function normalizeEmailCasing() {
  // Families: lowercase + dedupe the emails membership array
  const familiesSnapshot = await db.collection("families").get()
  let familyCount = 0
  for (const familyDoc of familiesSnapshot.docs) {
    const emails: string[] = familyDoc.data().emails ?? []
    const normalized = [...new Set(emails.map(normalizeEmail))]
    if (JSON.stringify(emails) !== JSON.stringify(normalized)) {
      await familyDoc.ref.update({emails: normalized})
      familyCount++
    }
  }
  console.log(`Normalized emails on ${familyCount} family docs`)

  // Registrations across all camp years: lowercase familyEmails
  const campsSnapshot = await db.collection("camps").get()
  let regCount = 0
  for (const campDoc of campsSnapshot.docs) {
    const regsSnapshot = await campDoc.ref.collection("registrations").get()
    for (const regDoc of regsSnapshot.docs) {
      const familyEmails: string[] = regDoc.data().familyEmails ?? []
      const normalized = [...new Set(familyEmails.map(normalizeEmail))]
      if (JSON.stringify(familyEmails) !== JSON.stringify(normalized)) {
        await regDoc.ref.update({familyEmails: normalized})
        regCount++
      }
    }
  }
  console.log(`Normalized familyEmails on ${regCount} registration docs`)

  // Admins: the email IS the doc ID, so re-key any non-lowercase docs
  const adminsSnapshot = await db.collection("admins").get()
  let adminCount = 0
  for (const adminDoc of adminsSnapshot.docs) {
    const normalizedId = normalizeEmail(adminDoc.id)
    if (adminDoc.id !== normalizedId) {
      await db.collection("admins").doc(normalizedId).set(adminDoc.data(), {merge: true})
      await adminDoc.ref.delete()
      adminCount++
    }
  }
  console.log(`Re-keyed ${adminCount} admin docs to lowercase IDs`)
}

async function main() {
  console.log("Starting RBAC migration...\n")

  console.log("Step 1: Migrating camper health and demographics to private sub-docs...")
  await migrateCamperData()

  console.log("\nStep 2: Adding roles to existing admin documents...")
  await migrateAdminRoles()

  console.log("\nStep 3: Normalizing email casing on families, registrations, and admins...")
  await normalizeEmailCasing()

  console.log("\nMigration complete!")
  console.log(
    "NOTE: Original fields on camper docs have NOT been deleted for backward compatibility."
  )
  console.log(
    "Run a separate cleanup script after verifying the new structure works."
  )
  process.exit(0)
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
