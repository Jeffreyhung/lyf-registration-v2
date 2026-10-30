/**
 * Backfill the schemaVersion 3 denormalized fields onto registrations.
 *
 * Since schemaVersion 3 every registration carries the camper's Tier-0
 * profile (`preferredName`, `birthDate`, `gender`, `pronouns`, `camperName`)
 * and the family's `parentContacts`, so the admin grid renders a year from
 * the registrations query alone. Registrations written before that still
 * make useRegistrations fall back to the camper + family + parents fan-out.
 * This script brings those older documents up to the new shape.
 *
 * For every camps/{year}/registrations/* document without `parentContacts`:
 *   - copies the profile fields from the camper document (`camper` ref)
 *   - builds `parentContacts` from the owning family's `parents`
 *     subcollection, ordered like Family.emails (signed-in parent first)
 *   - sets `schemaVersion: 3`
 *   - sets `spotReserved` (see the note next to it below)
 * Registrations whose camper or family document no longer exists are
 * skipped and counted; one bad document never fails the run.
 * Health and demographics are never copied: they stay under private/.
 *
 * Idempotent: a registration that already has `parentContacts` is left alone,
 * so the script can be re-run after a partial apply.
 *
 * Usage:
 *   ./run.sh -n backfillRegistrationDenormalizedFields            # dry run
 *   APPLY=1 ./run.sh -n backfillRegistrationDenormalizedFields    # write
 *   FIRESTORE_DATABASE_ID=<id> ./run.sh -n ...                    # other db
 */
import * as admin from "firebase-admin"
import {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  getFirestore,
  UpdateData,
  WriteBatch,
} from "firebase-admin/firestore"
import {
  CURRENT_SCHEMA_VERSION,
  normalizeEmail,
  ParentContact,
  RegistrationStatus,
} from "lyf-registration-schemas"

const app = admin.initializeApp()
// v2 data lives in a named database; "(default)" belongs to v1
const db = getFirestore(app, process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2")

const apply = process.env.APPLY === "1"

// Firestore caps a batch at 500 operations; stay comfortably under it.
const MAX_BATCH_WRITES = 400

type YearCounts = {
  total: number
  alreadyDone: number
  backfilled: number
  skippedNoCamperRef: number
  skippedCamperMissing: number
  skippedFamilyMissing: number
  errors: number
}

const newCounts = (): YearCounts => ({
  total: 0,
  alreadyDone: 0,
  backfilled: 0,
  skippedNoCamperRef: 0,
  skippedCamperMissing: 0,
  skippedFamilyMissing: 0,
  errors: 0,
})

// Document caches keyed by path: a family with several campers (or a camper
// registered across several years) is read once.
const camperCache = new Map<string, Promise<DocumentSnapshot>>()
const familyCache = new Map<string, Promise<DocumentSnapshot>>()
const parentsCache = new Map<string, Promise<ParentContact[]>>()

function cachedGet(
  cache: Map<string, Promise<DocumentSnapshot>>,
  ref: DocumentReference
): Promise<DocumentSnapshot> {
  let pending = cache.get(ref.path)
  if (!pending) {
    pending = ref.get()
    cache.set(ref.path, pending)
  }
  return pending
}

const asString = (value: unknown): string =>
  typeof value === "string" ? value : ""

// Same ordering useRegistrations applied client side: the position of the
// parent's email in Family.emails, unknown emails last. Emails are compared
// normalized because pre-v2 parent docs may still carry mixed case.
function parentIndex(email: string, emails: string[]): number {
  if (!email) {
    return Number.MAX_SAFE_INTEGER
  }
  const index = emails.indexOf(normalizeEmail(email))
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

function loadParentContacts(
  familyRef: DocumentReference,
  familyEmails: string[]
): Promise<ParentContact[]> {
  let pending = parentsCache.get(familyRef.path)
  if (!pending) {
    pending = familyRef
      .collection("parents")
      .get()
      .then((parents) => {
        const emails = familyEmails.map(normalizeEmail)
        return parents.docs
          .map((p) => p.data())
          .sort(
            (a, b) =>
              parentIndex(asString(a.email), emails) -
              parentIndex(asString(b.email), emails)
          )
          .map(
            (p): ParentContact => ({
              firstName: asString(p.firstName),
              lastName: asString(p.lastName),
              email: asString(p.email),
              phoneNumber: asString(p.phoneNumber),
            })
          )
      })
    parentsCache.set(familyRef.path, pending)
  }
  return pending
}

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
      const data = regDoc.data()
      if (Array.isArray(data.parentContacts)) {
        counts.alreadyDone++
        continue
      }

      const camperRef = data.camper
      if (!(camperRef instanceof DocumentReference)) {
        console.log(`  skip ${regDoc.ref.path}: no camper reference`)
        counts.skippedNoCamperRef++
        continue
      }

      const camperSnap = await cachedGet(camperCache, camperRef)
      if (!camperSnap.exists) {
        console.log(
          `  skip ${regDoc.ref.path}: camper ${camperRef.path} missing`
        )
        counts.skippedCamperMissing++
        continue
      }
      const camper = camperSnap.data() ?? {}

      const familyRef = camperRef.parent.parent
      if (!familyRef) {
        console.log(
          `  skip ${regDoc.ref.path}: camper ${camperRef.path} has no family`
        )
        counts.skippedFamilyMissing++
        continue
      }
      const familySnap = await cachedGet(familyCache, familyRef)
      if (!familySnap.exists) {
        console.log(
          `  skip ${regDoc.ref.path}: family ${familyRef.path} missing`
        )
        counts.skippedFamilyMissing++
        continue
      }
      const family = familySnap.data() ?? {}
      const familyEmails: string[] = Array.isArray(family.emails)
        ? family.emails.filter(
            (e: unknown): e is string => typeof e === "string"
          )
        : []

      const parentContacts = await loadParentContacts(familyRef, familyEmails)

      const update: Record<string, unknown> = {
        camperName: `${asString(camper.firstName)} ${asString(
          camper.lastName
        )}`.trim(),
        firstName: asString(camper.firstName),
        lastName: asString(camper.lastName),
        preferredName: camper.preferredName ?? null,
        pronouns: camper.pronouns ?? null,
        parentContacts,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        // Before schemaVersion 3 only the Stripe webhook (on paid) and the
        // camp-credit fast path decremented CampYear.remainingSpots, and both
        // did so while moving the registration to Active. Pending Payment and
        // Processing Payment registrations were never counted against the
        // cap, so they hold no spot that a later expiry could release; only
        // Active ones do.
        spotReserved: data.status === RegistrationStatus.ACTIVE,
      }
      // birthDate and gender have no "absent" sentinel in the schema, so copy
      // them only when the camper actually has them.
      if (typeof camper.birthDate === "string") {
        update.birthDate = camper.birthDate
      }
      if (Array.isArray(camper.gender)) {
        update.gender = camper.gender
      }

      if (!apply) {
        console.log(
          `  would update ${regDoc.ref.path}: ${update.camperName}, ` +
            `${parentContacts.length} parent contact(s), spotReserved=${update.spotReserved}`
        )
      }
      await writer.update(regDoc.ref, update)
      counts.backfilled++
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
  console.log(`Database: ${process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2"}`)

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

  const verb = apply ? "Backfilled" : "Would backfill"
  console.log("\n==== Summary ====")
  perYear.forEach((c, year) => {
    console.log(
      `${year}: ${c.total} registrations | already done ${c.alreadyDone} | ` +
        `${verb.toLowerCase()} ${c.backfilled} | skipped: no camper ref ${
          c.skippedNoCamperRef
        }, ` +
        `camper missing ${c.skippedCamperMissing}, family missing ${c.skippedFamilyMissing} | ` +
        `errors ${c.errors}`
    )
  })
  console.log(
    `\nTotal: ${totals.total} registrations | already done ${totals.alreadyDone} | ` +
      `${verb.toLowerCase()} ${totals.backfilled} | skipped ${
        totals.skippedNoCamperRef +
        totals.skippedCamperMissing +
        totals.skippedFamilyMissing
      } | errors ${totals.errors}`
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
