/**
 * Backfill `createdBy` on legacy family documents.
 *
 * findOrCreateFamily only registers a caller into a family they are an
 * established member of (see isEstablishedFamilyMember in the schemas
 * package): the creator, someone who confirmed it, or its sole member.
 * Families written before `createdBy` existed have no creator on record, so a
 * multi-email legacy family would make every one of its parents confirm it on
 * their next registration.
 *
 * This script stamps `createdBy` on legacy families that list exactly one
 * email (that person is unambiguously the owner). Families with several
 * emails are left untouched and printed for manual review.
 *
 * Usage:
 *   ./run.sh -n backfillFamilyCreatedBy            # dry run: report only
 *   APPLY=1 ./run.sh -n backfillFamilyCreatedBy    # write the changes
 */
import * as admin from "firebase-admin"
import {getFirestore} from "firebase-admin/firestore"
import {normalizeEmails} from "lyf-registration-schemas"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2")

const apply = process.env.APPLY === "1"

async function main() {
  console.log(apply ? "Applying changes" : "Dry run (set APPLY=1 to write)")

  const families = await db.collection("families").get()

  let alreadySet = 0
  let backfilled = 0
  const needsReview: string[] = []
  const noEmails: string[] = []

  for (const familyDoc of families.docs) {
    const data = familyDoc.data()
    if (typeof data.createdBy === "string" && data.createdBy.length > 0) {
      alreadySet++
      continue
    }

    const emails = normalizeEmails(
      Array.isArray(data.emails) ? data.emails : []
    )

    if (emails.length === 0) {
      noEmails.push(familyDoc.id)
      continue
    }

    if (emails.length > 1) {
      needsReview.push(`${familyDoc.id}: ${emails.join(", ")}`)
      continue
    }

    const [owner] = emails
    console.log(
      `${apply ? "Setting" : "Would set"} createdBy=${owner} on families/${familyDoc.id}`
    )
    if (apply) {
      await familyDoc.ref.update({createdBy: owner})
    }
    backfilled++
  }

  console.log(`\nFamilies: ${families.size}`)
  console.log(`Already had createdBy: ${alreadySet}`)
  console.log(
    `${apply ? "Backfilled" : "Would backfill"} (single email): ${backfilled}`
  )

  if (noEmails.length > 0) {
    console.log(`\nNo emails listed (left alone): ${noEmails.length}`)
    noEmails.forEach((id) => console.log(`  ${id}`))
  }

  if (needsReview.length > 0) {
    console.log(
      `\nMultiple emails, no creator on record (left alone, review manually): ${needsReview.length}`
    )
    needsReview.forEach((line) => console.log(`  ${line}`))
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
