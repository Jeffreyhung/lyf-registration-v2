/**
 * Phase 2 of the RBAC migration: remove health/demographics data from the
 * documents every admin role can read, now that it lives under
 * families/{familyId}/campers/{camperId}/private/{health,demographics}.
 *
 * Until this runs, the RBAC split is cosmetic — program_staff can still read
 * medical conditions straight off the camper doc.
 *
 * For every camper with legacy fields:
 *   1. Verify the private/ copy exists. If a private field is missing, copy
 *      the legacy value in (never overwrite a private value — it may have
 *      been edited since migration).
 *   2. Delete the legacy fields from the camper doc and stamp schemaVersion.
 * For every registration (all camp years) with a legacy `demographics` map:
 *   3. Ensure the camper's private/demographics has the data, then delete it
 *      from the registration.
 *
 * DRY RUN by default — prints what it would do. Pass --apply to write.
 *   ./run.sh -n cleanupLegacyCamperFields            (dry run)
 *   APPLY=1 ./run.sh -n cleanupLegacyCamperFields    (apply)
 */
import * as admin from "firebase-admin"
import {getFirestore} from "firebase-admin/firestore"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2")

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply")
const HEALTH_FIELDS = ["medicalConditions", "dietAndFoodAllergies"] as const
const SCHEMA_VERSION = 2

type Counts = Record<string, number>
const counts: Counts = {}
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)

function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim() !== ""
  if (typeof value === "object") return Object.keys(value as object).length > 0
  return true
}

async function cleanupCampers() {
  const families = await db.collection("families").get()

  for (const familyDoc of families.docs) {
    const campers = await familyDoc.ref.collection("campers").get()

    for (const camperDoc of campers.docs) {
      const data = camperDoc.data()
      const legacyHealth: Record<string, unknown> = {}
      for (const f of HEALTH_FIELDS) {
        if (data[f] !== undefined) legacyHealth[f] = data[f]
      }
      const legacyDemographics = data.demographics
      const hasLegacy =
        Object.keys(legacyHealth).length > 0 || legacyDemographics !== undefined
      if (!hasLegacy) continue

      bump("campersWithLegacyFields")
      const privateRef = camperDoc.ref.collection("private")
      const [healthSnap, demoSnap] = await Promise.all([
        privateRef.doc("health").get(),
        privateRef.doc("demographics").get(),
      ])

      // 1. Backfill any private field the migration missed
      const healthBackfill: Record<string, unknown> = {}
      const privateHealth = healthSnap.data() ?? {}
      for (const [f, v] of Object.entries(legacyHealth)) {
        if (!isNonEmpty(privateHealth[f]) && isNonEmpty(v)) {
          healthBackfill[f] = v
        }
      }
      if (Object.keys(healthBackfill).length > 0) {
        bump("healthBackfilled")
        console.log(
          `  backfill health  ${camperDoc.ref.path}: ${Object.keys(healthBackfill)}`
        )
        if (APPLY)
          await privateRef.doc("health").set(healthBackfill, {merge: true})
      }

      if (isNonEmpty(legacyDemographics) && !isNonEmpty(demoSnap.data())) {
        bump("demographicsBackfilled")
        console.log(`  backfill demographics  ${camperDoc.ref.path}`)
        if (APPLY)
          await privateRef
            .doc("demographics")
            .set(legacyDemographics, {merge: true})
      }

      // 2. Strip the legacy fields
      const update: Record<string, unknown> = {schemaVersion: SCHEMA_VERSION}
      for (const f of Object.keys(legacyHealth))
        update[f] = admin.firestore.FieldValue.delete()
      if (legacyDemographics !== undefined) {
        update.demographics = admin.firestore.FieldValue.delete()
      }
      console.log(
        `  strip  ${camperDoc.ref.path}: ${Object.keys(update).filter((k) => k !== "schemaVersion")}`
      )
      if (APPLY) await camperDoc.ref.update(update)
      bump("campersCleaned")
    }
  }
}

async function cleanupRegistrations() {
  const camps = await db.collection("camps").get()

  for (const campDoc of camps.docs) {
    const regs = await campDoc.ref.collection("registrations").get()

    for (const regDoc of regs.docs) {
      const data = regDoc.data()
      if (data.demographics === undefined) continue
      bump("registrationsWithLegacyDemographics")

      const camperRef = data.camper as
        | admin.firestore.DocumentReference
        | undefined
      if (camperRef && isNonEmpty(data.demographics)) {
        const demoRef = camperRef.collection("private").doc("demographics")
        const demoSnap = await demoRef.get()
        if (!isNonEmpty(demoSnap.data())) {
          bump("registrationDemographicsMovedToCamper")
          console.log(
            `  move demographics  ${regDoc.ref.path} -> ${demoRef.path}`
          )
          if (APPLY) await demoRef.set(data.demographics, {merge: true})
        }
      }

      console.log(`  strip  ${regDoc.ref.path}: demographics`)
      if (APPLY) {
        await regDoc.ref.update({
          demographics: admin.firestore.FieldValue.delete(),
          schemaVersion: SCHEMA_VERSION,
        })
      }
      bump("registrationsCleaned")
    }
  }
}

async function main() {
  console.log(
    APPLY
      ? "APPLY mode — writing changes\n"
      : "DRY RUN — no writes (set APPLY=1 to apply)\n"
  )

  console.log("Step 1: Campers")
  await cleanupCampers()

  console.log("\nStep 2: Registrations")
  await cleanupRegistrations()

  console.log("\nSummary:")
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`)
  if (!APPLY)
    console.log(
      "\nDry run complete. Re-run with APPLY=1 to make these changes."
    )
  process.exit(0)
}

main().catch((err) => {
  console.error("Cleanup failed:", err)
  process.exit(1)
})
