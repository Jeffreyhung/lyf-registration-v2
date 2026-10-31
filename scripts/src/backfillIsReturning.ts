/**
 * Repair legacy field-type problems that a Read-validator scan of production
 * turned up. Despite the name (it started with `isReturning` alone) the
 * script runs four independent repairs, each with its own counts:
 *
 * 1. `isReturning` stored as the string "true" / "false" on
 *    camps/{year}/registrations/*. The website's "Has this camper attended
 *    LYF camp before?" radio used to dispatch the radio's event value. The
 *    website now sends a boolean and the payload validator coerces the two
 *    legacy strings; this converts the stored documents. Any other string is
 *    reported and left alone.
 * 2. `grade` equal to NaN on registrations. Pre-registrations fulfilled
 *    before the current guard were written as `parseInt("") + 1`. The
 *    function now writes no grade at all when none is known, so the field is
 *    deleted.
 * 3. `hasContacted === false` on registrations. The field marks a waitlisted
 *    family as contacted and its type is the literal `true`; a false is the
 *    same as absent, so the field is deleted.
 * 4. `amountRemaining` stored as a string on credits/{familyId}. The field is
 *    written back as a number. This one matters most: fulfillRegistration
 *    applies `FieldValue.increment(-campCreditUsed)` to it, and an increment
 *    on a non-numeric field replaces the field with the operand, so the
 *    family's credit would go negative on their next registration. A string
 *    that does not parse to a finite number is reported and left alone.
 *
 * Nothing else on any document is touched. Every update is checked with the
 * matching Write validator (`validateRegistrationWrite`,
 * `validateCampCreditWrite`) before it is queued; a document that fails
 * validation is counted as an error and skipped. Registrations are read once
 * and the three registration repairs are merged into one write per document.
 *
 * Idempotent: documents that already hold the right shape are skipped, so
 * the script can be re-run after a partial apply.
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
  DocumentSnapshot,
  FieldValue,
  getFirestore,
  UpdateData,
  WriteBatch,
} from "firebase-admin/firestore"
import {
  validateCampCreditWrite,
  validateRegistrationWrite,
} from "lyf-registration-schemas"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const databaseId = process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2"
const db = getFirestore(app, databaseId)

const apply = process.env.APPLY === "1"

// Firestore caps a batch at 500 operations; stay comfortably under it.
const MAX_BATCH_WRITES = 400

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

// ---------------------------------------------------------------------------
// Repairs. Each looks at one document and either returns the fields to
// update, `null` when the document is fine, or throws for a value it does not
// know how to handle (reported as "unexpected", never written).

class UnexpectedValue extends Error {}

type Repair = {
  /** Short label used in log lines and the summary. */
  name: string
  check: (snap: DocumentSnapshot) => Record<string, unknown> | null
  describe: (snap: DocumentSnapshot, update: Record<string, unknown>) => string
}

const isReturningRepair: Repair = {
  name: "isReturning string -> boolean",
  check(snap) {
    const value: unknown = snap.get("isReturning")
    if (value === undefined || typeof value === "boolean") {
      return null
    }
    if (value !== "true" && value !== "false") {
      throw new UnexpectedValue(`isReturning=${JSON.stringify(value)}`)
    }
    return {isReturning: value === "true"}
  },
  describe: (snap, update) =>
    `isReturning ${JSON.stringify(snap.get("isReturning"))} -> ${
      update.isReturning
    }`,
}

const gradeNaNRepair: Repair = {
  name: "grade NaN -> deleted",
  check(snap) {
    const value: unknown = snap.get("grade")
    if (typeof value === "number" && Number.isNaN(value)) {
      return {grade: FieldValue.delete()}
    }
    return null
  },
  describe: () => "grade NaN -> (deleted)",
}

const hasContactedFalseRepair: Repair = {
  name: "hasContacted false -> deleted",
  check(snap) {
    const value: unknown = snap.get("hasContacted")
    if (value === undefined || value === true) {
      return null
    }
    if (value !== false) {
      throw new UnexpectedValue(`hasContacted=${JSON.stringify(value)}`)
    }
    return {hasContacted: FieldValue.delete()}
  },
  describe: () => "hasContacted false -> (deleted)",
}

const amountRemainingStringRepair: Repair = {
  name: "amountRemaining string -> number",
  check(snap) {
    const value: unknown = snap.get("amountRemaining")
    if (typeof value !== "string") {
      return null
    }
    const parsed = value.trim() === "" ? NaN : Number(value)
    if (!Number.isFinite(parsed)) {
      throw new UnexpectedValue(`amountRemaining=${JSON.stringify(value)}`)
    }
    return {amountRemaining: parsed}
  },
  describe: (snap, update) =>
    `amountRemaining ${JSON.stringify(snap.get("amountRemaining"))} -> ${
      update.amountRemaining
    }`,
}

const registrationRepairs: Repair[] = [
  isReturningRepair,
  gradeNaNRepair,
  hasContactedFalseRepair,
]
const creditRepairs: Repair[] = [amountRemainingStringRepair]

// ---------------------------------------------------------------------------
// Counting. One tally per repair, broken down by group (camp year for
// registrations, "credits" for the credits collection).

type Tally = {fixed: number; unexpected: number; errors: number}
const newTally = (): Tally => ({fixed: 0, unexpected: 0, errors: 0})

class Counts {
  private perRepair = new Map<string, Map<string, Tally>>()
  scanned = new Map<string, number>()

  tally(repair: Repair, group: string): Tally {
    let groups = this.perRepair.get(repair.name)
    if (!groups) {
      groups = new Map()
      this.perRepair.set(repair.name, groups)
    }
    let t = groups.get(group)
    if (!t) {
      t = newTally()
      groups.set(group, t)
    }
    return t
  }

  addScanned(group: string, n: number) {
    this.scanned.set(group, (this.scanned.get(group) ?? 0) + n)
  }

  totals(repair: Repair): Tally {
    const total = newTally()
    this.perRepair.get(repair.name)?.forEach((t) => {
      total.fixed += t.fixed
      total.unexpected += t.unexpected
      total.errors += t.errors
    })
    return total
  }

  breakdown(repair: Repair): string {
    const parts: string[] = []
    this.perRepair.get(repair.name)?.forEach((t, group) => {
      if (t.fixed > 0) {
        parts.push(`${group}: ${t.fixed}`)
      }
    })
    return parts.join(", ")
  }
}

const counts = new Counts()

// ---------------------------------------------------------------------------

async function repairDocuments(
  docs: DocumentSnapshot[],
  group: string,
  repairs: Repair[],
  validate: (update: unknown) => unknown,
  writer: BatchWriter
) {
  counts.addScanned(group, docs.length)

  for (const snap of docs) {
    const update: Record<string, unknown> = {}
    const applied: string[] = []

    for (const repair of repairs) {
      const t = counts.tally(repair, group)
      try {
        const fields = repair.check(snap)
        if (!fields) {
          continue
        }
        // Throws SchemaValidationError if the update would not pass the
        // document contract. The original fields are written (not the
        // validator's copy) so FieldValue sentinels keep their identity.
        validate(fields)
        Object.assign(update, fields)
        applied.push(repair.describe(snap, fields))
        t.fixed++
      } catch (err) {
        if (err instanceof UnexpectedValue) {
          console.log(
            `  unexpected ${snap.ref.path}: ${err.message} (left alone)`
          )
          t.unexpected++
        } else {
          console.error(
            `  error on ${snap.ref.path} (${repair.name}):`,
            err instanceof Error ? err.message : err
          )
          t.errors++
        }
      }
    }

    if (applied.length === 0) {
      continue
    }
    console.log(
      `  ${apply ? "update" : "would update"} ${snap.ref.path}: ${applied.join(
        "; "
      )}`
    )
    await writer.update(snap.ref, update)
  }
}

async function main() {
  console.log(apply ? "Applying changes" : "Dry run (set APPLY=1 to write)")
  console.log(`Database: ${databaseId}`)

  const writer = new BatchWriter()

  // listDocuments (not get) so camp years whose parent document was never
  // created but still own a registrations subcollection are included.
  const campRefs = await db.collection("camps").listDocuments()
  campRefs.sort((a, b) => a.id.localeCompare(b.id))

  for (const campRef of campRefs) {
    console.log(`\n== camps/${campRef.id} ==`)
    const registrations = await campRef.collection("registrations").get()
    await repairDocuments(
      registrations.docs,
      campRef.id,
      registrationRepairs,
      validateRegistrationWrite,
      writer
    )
  }

  console.log("\n== credits ==")
  const credits = await db.collection("credits").get()
  await repairDocuments(
    credits.docs,
    "credits",
    creditRepairs,
    validateCampCreditWrite,
    writer
  )

  await writer.flush()

  const verb = apply ? "fixed" : "would fix"
  let registrationsScanned = 0
  counts.scanned.forEach((n, group) => {
    if (group !== "credits") {
      registrationsScanned += n
    }
  })
  console.log("\n==== Summary ====")
  console.log(
    `Registrations scanned: ${registrationsScanned} | credits scanned: ${
      counts.scanned.get("credits") ?? 0
    }`
  )

  let errors = 0
  for (const repair of [...registrationRepairs, ...creditRepairs]) {
    const t = counts.totals(repair)
    errors += t.errors
    const breakdown = counts.breakdown(repair)
    console.log(
      `${repair.name}: ${verb} ${t.fixed} | unexpected value ${t.unexpected} | errors ${t.errors}` +
        (breakdown ? `  (${breakdown})` : "")
    )
  }
  if (apply) {
    console.log(`Writes committed: ${writer.committed}`)
  }

  process.exit(errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
