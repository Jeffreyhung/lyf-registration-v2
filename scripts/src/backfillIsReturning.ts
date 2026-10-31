/**
 * Convert string `isReturning` values on registrations back to booleans.
 *
 * The website's "Has this camper attended LYF camp before?" radio used to
 * dispatch the radio's event value, so `isReturning` reached the
 * registration documents as the string "true" or "false" instead of a
 * boolean. The website now sends a boolean and the payload validator
 * coerces the two legacy strings, but documents written before that fix
 * still fail `validateRegistrationRead`, which requires a boolean.
 *
 * For every camps/{year}/registrations/* document whose `isReturning` is the
 * string "true" or "false": sets it to the boolean `true` / `false`.
 * Nothing else on the document is touched. Any other string value is
 * reported and left alone, so a surprise never turns into a silent write.
 * Each update is checked with `validateRegistrationWrite` before it is
 * queued.
 *
 * Idempotent: documents that already hold a boolean are skipped, so the
 * script can be re-run after a partial apply.
 *
 * Usage:
 *   ./run.sh -n backfillIsReturning            # dry run
 *   APPLY=1 ./run.sh -n backfillIsReturning    # write
 *   FIRESTORE_DATABASE_ID=<id> ./run.sh -n ...  # other db (default lyf-v2)
 */
import * as admin from "firebase-admin"
import {
  DocumentData,
  DocumentReference,
  getFirestore,
  UpdateData,
  WriteBatch,
} from "firebase-admin/firestore"
import {validateRegistrationWrite} from "lyf-registration-schemas"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const databaseId = process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2"
const db = getFirestore(app, databaseId)

const apply = process.env.APPLY === "1"

// Firestore caps a batch at 500 operations; stay comfortably under it.
const MAX_BATCH_WRITES = 400

type YearCounts = {
  total: number
  alreadyBoolean: number
  missing: number
  converted: number
  unexpectedValue: number
  errors: number
}

const newCounts = (): YearCounts => ({
  total: 0,
  alreadyBoolean: 0,
  missing: 0,
  converted: 0,
  unexpectedValue: 0,
  errors: 0,
})

class BatchWriter {
  private batch: WriteBatch | null = null
  private pendingWrites = 0
  committed = 0

  async update(ref: DocumentReference, data: Record<string, unknown>) {
    if (!apply) {
      return
    }
    if (!this.batch) {
      this.batch = db.batch()
    }
    this.batch.update(ref, data as UpdateData<DocumentData>)
    this.pendingWrites++
    if (this.pendingWrites >= MAX_BATCH_WRITES) {
      await this.flush()
    }
  }

  async flush() {
    if (!this.batch || this.pendingWrites === 0) {
      return
    }
    await this.batch.commit()
    this.committed += this.pendingWrites
    console.log(`  committed batch of ${this.pendingWrites} writes`)
    this.batch = null
    this.pendingWrites = 0
  }
}

async function backfillYear(
  campRef: DocumentReference,
  writer: BatchWriter
): Promise<YearCounts> {
  const counts = newCounts()
  const registrations = await campRef.collection("registrations").get()
  counts.total = registrations.size

  for (const regDoc of registrations.docs) {
    try {
      const value: unknown = regDoc.get("isReturning")

      if (typeof value === "boolean") {
        counts.alreadyBoolean++
        continue
      }
      if (value === undefined) {
        counts.missing++
        continue
      }
      if (value !== "true" && value !== "false") {
        console.log(
          `  unexpected ${regDoc.ref.path}: isReturning=${JSON.stringify(
            value
          )} (left alone)`
        )
        counts.unexpectedValue++
        continue
      }

      // Throws SchemaValidationError if the update would not pass the
      // document contract; the catch below counts it and moves on.
      const update = validateRegistrationWrite({isReturning: value === "true"})

      console.log(
        `  ${apply ? "update" : "would update"} ${regDoc.ref.path}: ` +
          `isReturning ${JSON.stringify(value)} -> ${update.isReturning}`
      )
      await writer.update(regDoc.ref, update)
      counts.converted++
    } catch (err) {
      counts.errors++
      console.error(
        `  error on ${regDoc.ref.path}:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  return counts
}

async function main() {
  console.log(apply ? "Applying changes" : "Dry run (set APPLY=1 to write)")
  console.log(`Database: ${databaseId}`)

  // listDocuments (not get) so camp years whose parent document was never
  // created but still own a registrations subcollection are included.
  const campRefs = await db.collection("camps").listDocuments()
  campRefs.sort((a, b) => a.id.localeCompare(b.id))

  const writer = new BatchWriter()
  const perYear = new Map<string, YearCounts>()
  const totals = newCounts()

  for (const campRef of campRefs) {
    console.log(`\n== camps/${campRef.id} ==`)
    const counts = await backfillYear(campRef, writer)
    perYear.set(campRef.id, counts)
    ;(Object.keys(totals) as (keyof YearCounts)[]).forEach((key) => {
      totals[key] += counts[key]
    })
  }
  await writer.flush()

  const verb = apply ? "converted" : "would convert"
  console.log("\n==== Summary ====")
  perYear.forEach((c, year) => {
    console.log(
      `${year}: ${c.total} registrations | already boolean ${c.alreadyBoolean} | ` +
        `missing ${c.missing} | ${verb} ${c.converted} | ` +
        `unexpected value ${c.unexpectedValue} | errors ${c.errors}`
    )
  })
  console.log(
    `\nTotal: ${totals.total} registrations | already boolean ${totals.alreadyBoolean} | ` +
      `missing ${totals.missing} | ${verb} ${totals.converted} | ` +
      `unexpected value ${totals.unexpectedValue} | errors ${totals.errors}`
  )
  if (apply) {
    console.log(`Writes committed: ${writer.committed}`)
  }

  process.exit(totals.errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
