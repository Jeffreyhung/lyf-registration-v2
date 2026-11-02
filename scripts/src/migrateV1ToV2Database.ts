/**
 * ETL: copy the v1 production database into the v2 database, transforming to
 * the v2 schema on the way.
 *
 * Why not `gcloud firestore import`? A managed import into a different database
 * leaves every DocumentReference pointing at the source database, and the v2
 * schema needs field-level changes anyway. This script does both.
 *
 * Transforms (everything else is copied verbatim, with refs rewritten):
 *   families/{id}                     emails lowercased + deduped; schemaVersion
 *   families/{id}/parents/{email}     doc ID + email lowercased;
 *                                     subscribeToMailingList "true"/"false" -> boolean
 *   families/{id}/campers/{id}        medicalConditions/dietAndFoodAllergies -> private/health
 *                                     demographics -> private/demographics; schemaVersion
 *   camps/{year}                      CREATE-ONLY: v2 owns these documents (the Camp
 *                                     Year tab writes dates, fees, caps and remainingSpots
 *                                     through manageCampYear), so an existing target
 *                                     document is left untouched. Only its registrations
 *                                     subcollection is synced.
 *   camps/{year}/registrations/{id}   familyEmails added (from the owning family);
 *                                     legacy demographics moved to the camper's
 *                                     private/demographics when absent there; schemaVersion;
 *                                     grade NaN -> field deleted; isReturning
 *                                     "true"/"false" -> boolean; hasContacted false -> deleted
 *   credits/{familyId}                CREATE-ONLY (v2 functions increment amountRemaining);
 *                                     a string amountRemaining is written as a number
 *   admins/{email}                    created from Auth users with the v1 `admin` custom
 *                                     claim, only while the target has no roster yet
 *                                     (create-only: never overwrites a role you set)
 *
 * Idempotent delta sync: every planned document is read from the target
 * first and merged only when the merge would change something, so a re-run
 * writes exactly the documents that are new or differ (the summary lists
 * them). Because the merge still copies source values over target values,
 * the target must be treated as read-only for ETL-managed fields until the
 * final run — edits there are overwritten by the next sync. The create-only
 * collections above and the legacy-field repairs are the exceptions: they
 * exist so that a re-sync never undoes the repairs made in the target (see
 * scripts/src/backfillIsReturning.ts) or the camp configuration entered in
 * the dashboard.
 *
 * DRY RUN by default. APPLY=1 writes.
 *   SOURCE_DB='(default)' TARGET_DB=lyf-v2 ./run.sh -n migrateV1ToV2Database
 *   APPLY=1 SOURCE_DB='(default)' TARGET_DB=lyf-v2 ./run.sh -n migrateV1ToV2Database
 *
 * Seeding the test database from the v1 test database, with the admin roster
 * mirrored from the live v2 database rather than derived from v1 Auth claims
 * (security rules resolve admins/{email} per database, so the test database
 * needs its own copy of the roster):
 *   APPLY=1 SOURCE_DB=internal-test TARGET_DB=lyf-v2-test ADMINS_FROM_DB=lyf-v2 \
 *     ./run.sh -n migrateV1ToV2Database
 */
import * as admin from "firebase-admin"
import {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  GeoPoint,
  Timestamp,
  WriteBatch,
  getFirestore,
} from "firebase-admin/firestore"

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply")
const SOURCE_DB = process.env.SOURCE_DB ?? "(default)"
const TARGET_DB = process.env.TARGET_DB ?? "lyf-v2"
// When set, the admin roster is copied verbatim from this database instead of
// being rebuilt from SOURCE_DB admins + v1 Auth custom claims.
const ADMINS_FROM_DB = process.env.ADMINS_FROM_DB
const SCHEMA_VERSION = 2

if (SOURCE_DB === TARGET_DB) {
  console.error(
    `SOURCE_DB and TARGET_DB are both "${SOURCE_DB}" — refusing to run.`
  )
  process.exit(1)
}

if (ADMINS_FROM_DB === TARGET_DB) {
  console.error(
    `ADMINS_FROM_DB and TARGET_DB are both "${TARGET_DB}" — refusing to run.`
  )
  process.exit(1)
}

const app = admin.initializeApp()
const source = getFirestore(app, SOURCE_DB)
const target = getFirestore(app, TARGET_DB)
const adminsSource = ADMINS_FROM_DB ? getFirestore(app, ADMINS_FROM_DB) : null

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

const sourceCounts: Record<string, number> = {}
const writeCounts: Record<string, number> = {}
/** Distinct target paths per group — several source docs can merge into one
 *  (e.g. parent docs whose IDs differ only by case). */
const plannedPaths: Record<string, Set<string>> = {}
/** Per group: how many planned documents the merge would create, update or
 *  leave as they are (the target already holds the same values). */
type ChangeKind = "create" | "update" | "unchanged"
const changeCounts: Record<ChangeKind, Record<string, number>> = {
  create: {},
  update: {},
  unchanged: {},
}
/** Every document the merge would actually touch, with the fields involved. */
const changedDocs: {kind: ChangeKind; path: string; fields: string[]}[] = []
/** Create-only documents that already exist in the target and were left alone. */
const keptCounts: Record<string, number> = {}
/** Legacy-field repairs applied on the way, by kind. */
const repairCounts: Record<string, number> = {}
const warnings: string[] = []
const referencedPaths = new Set<string>()

const bump = (map: Record<string, number>, key: string) =>
  (map[key] = (map[key] ?? 0) + 1)
const warn = (msg: string) => warnings.push(msg)

/**
 * Top-level collections whose documents are created when missing from the
 * target but never merged into when present: v2 code or the dashboard owns
 * them once they exist. `camps` is handled the same way in migrateCamps.
 */
const CREATE_ONLY_COLLECTIONS = new Set(["credits"])

async function existsInTarget(ref: DocumentReference): Promise<boolean> {
  return (await ref.get()).exists
}

/**
 * v1's radio buttons stored some booleans as the strings "true"/"false".
 * Returns the boolean for those two strings, the value unchanged otherwise.
 */
function legacyBoolean(value: unknown): unknown {
  if (value === "true") return true
  if (value === "false") return false
  return value
}

/** In-place repairs of the legacy field shapes found on v1 registrations. */
function repairRegistrationFields(out: Record<string, unknown>) {
  if (typeof out.grade === "number" && Number.isNaN(out.grade)) {
    // Merge semantics: FieldValue.delete() also clears a NaN already in the target.
    out.grade = FieldValue.delete()
    bump(repairCounts, "registration.grade NaN deleted")
  }
  if (out.isReturning === "true" || out.isReturning === "false") {
    out.isReturning = legacyBoolean(out.isReturning)
    bump(repairCounts, "registration.isReturning string -> boolean")
  }
  if (out.hasContacted === false) {
    out.hasContacted = FieldValue.delete()
    bump(repairCounts, "registration.hasContacted false deleted")
  }
}

/** Collection-group key for counting: "families/parents", "camps/registrations", ... */
function groupKey(path: string): string {
  const segments = path.split("/")
  const collections = segments.filter((_, i) => i % 2 === 0)
  return collections.join("/")
}

const normalizeEmail = (e: string) => e.trim().toLowerCase()
const normalizeEmails = (emails: unknown): string[] =>
  Array.isArray(emails)
    ? [
        ...new Set(
          emails
            .filter((e): e is string => typeof e === "string")
            .map(normalizeEmail)
        ),
      ]
    : []

const isNonEmpty = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  !(typeof v === "string" && v.trim() === "") &&
  !(
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 0
  )

// ---------------------------------------------------------------------------
// Change detection: would `set(ref, data, {merge: true})` alter the target?
// ---------------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && (v as object).constructor === Object

const DELETE_SENTINEL = FieldValue.delete()

/** Deep equality for stored Firestore values (arrays compare as a whole). */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a === "number" && typeof b === "number") return a === b
  if (a instanceof Timestamp && b instanceof Timestamp) return a.isEqual(b)
  if (a instanceof DocumentReference && b instanceof DocumentReference)
    return a.path === b.path
  if (a instanceof GeoPoint && b instanceof GeoPoint) return a.isEqual(b)
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => k in b && sameValue(a[k], b[k]))
    )
  }
  return false
}

/**
 * Top-level fields of `data` whose merge into `existing` would change the
 * stored document. Mirrors merge semantics: nested maps merge field by
 * field, arrays are replaced, FieldValue.delete() removes a field (a no-op
 * when the field is already absent), other sentinels always count as a change.
 */
function changedFields(
  existing: Record<string, unknown>,
  data: Record<string, unknown>
): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) {
      if (value.isEqual(DELETE_SENTINEL) ? key in existing : true) out.push(key)
    } else if (!(key in existing)) {
      out.push(key)
    } else if (isPlainObject(value) && isPlainObject(existing[key])) {
      if (changedFields(existing[key], value).length) out.push(key)
    } else if (!sameValue(value, existing[key])) {
      out.push(key)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Writer: reads the target in chunks, merges only what would change, and in
// dry-run just records what would change
// ---------------------------------------------------------------------------

/** Documents compared (and, in APPLY mode, committed) per round trip. */
const CHUNK = 100

class Writer {
  private pending: {ref: DocumentReference; data: Record<string, unknown>}[] =
    []

  async set(ref: DocumentReference, data: Record<string, unknown>) {
    const group = groupKey(ref.path)
    bump(writeCounts, group)
    ;(plannedPaths[group] ??= new Set()).add(ref.path)
    this.pending.push({ref, data})
    if (this.pending.length >= CHUNK) await this.flush()
  }

  async flush() {
    if (this.pending.length === 0) return
    const items = this.pending
    this.pending = []
    const snaps = await target.getAll(...items.map((i) => i.ref))
    let batch: WriteBatch | null = null
    let queued = 0
    items.forEach(({ref, data}, i) => {
      const group = groupKey(ref.path)
      const existing = snaps[i].exists ? snaps[i].data() : undefined
      const fields = existing
        ? changedFields(existing, data)
        : Object.keys(data)
      const kind: ChangeKind = !existing
        ? "create"
        : fields.length
          ? "update"
          : "unchanged"
      bump(changeCounts[kind], group)
      if (kind === "unchanged") return
      changedDocs.push({kind, path: ref.path, fields})
      if (!APPLY) return
      batch ??= target.batch()
      batch.set(ref, data, {merge: true})
      queued++
    })
    if (batch && queued > 0) await (batch as WriteBatch).commit()
  }
}
const writer = new Writer()

// ---------------------------------------------------------------------------
// Value rewriting: DocumentReferences re-bound to the target database
// ---------------------------------------------------------------------------

function rewrite(value: unknown): unknown {
  if (value instanceof DocumentReference) {
    referencedPaths.add(value.path)
    return target.doc(value.path)
  }
  if (Array.isArray(value)) return value.map(rewrite)
  if (value === null || value instanceof Timestamp || value instanceof GeoPoint)
    return value
  if (typeof value === "object" && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = rewrite(v)
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Generic copy (used for anything without a specific transform)
// ---------------------------------------------------------------------------

async function copySubcollections(
  sourceDoc: DocumentReference,
  targetDoc: DocumentReference
) {
  for (const sub of await sourceDoc.listCollections()) {
    await copyCollection(sub, targetDoc.collection(sub.id))
  }
}

async function copyCollection(
  from: CollectionReference,
  to: CollectionReference,
  options: {createOnly?: boolean} = {}
) {
  const snap = await from.get()
  for (const doc of snap.docs) {
    const group = groupKey(doc.ref.path)
    bump(sourceCounts, group)
    const targetRef = to.doc(doc.id)
    if (options.createOnly && (await existsInTarget(targetRef))) {
      bump(keptCounts, group)
    } else {
      const data = rewrite(doc.data()) as Record<string, unknown>
      if (from.id === "credits") repairCreditFields(data)
      await writer.set(targetRef, data)
    }
    await copySubcollections(doc.ref, targetRef)
  }
}

/** credits/{familyId}.amountRemaining must be a number: v2 applies
 *  FieldValue.increment() to it, which would replace a string outright. */
function repairCreditFields(data: Record<string, unknown>) {
  if (typeof data.amountRemaining === "string") {
    const parsed = Number(data.amountRemaining.trim())
    if (data.amountRemaining.trim() !== "" && Number.isFinite(parsed)) {
      data.amountRemaining = parsed
      bump(repairCounts, "credit.amountRemaining string -> number")
    } else {
      warn(
        `credit amountRemaining "${data.amountRemaining}" is not a number; copied as-is`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// families / parents / campers
// ---------------------------------------------------------------------------

/** familyId -> normalized emails, for registrations.familyEmails */
const familyEmailsById = new Map<string, string[]>()
/** camper paths that will have a non-empty private/demographics in the target */
const campersWithDemographics = new Set<string>()

const HEALTH_FIELDS = ["medicalConditions", "dietAndFoodAllergies"] as const

async function migrateFamilies() {
  const families = await source.collection("families").get()
  console.log(`  ${families.size} families to read (one line per 100)`)

  for (const [index, family] of families.docs.entries()) {
    if (index > 0 && index % 100 === 0)
      console.log(`  … ${index}/${families.size} families`)
    bump(sourceCounts, "families")
    const data = family.data()
    const emails = normalizeEmails(data.emails)
    if (emails.length === 0) warn(`family ${family.id} has no emails`)
    familyEmailsById.set(family.id, emails)

    const targetFamily = target.collection("families").doc(family.id)
    await writer.set(targetFamily, {
      ...(rewrite(data) as Record<string, unknown>),
      emails,
      schemaVersion: SCHEMA_VERSION,
    })

    // parents — keyed by email, so the doc ID is normalized too
    const parents = await family.ref.collection("parents").get()
    for (const parent of parents.docs) {
      bump(sourceCounts, "families/parents")
      const pdata = parent.data()
      const email = normalizeEmail(
        typeof pdata.email === "string" ? pdata.email : parent.id
      )
      const targetParent = targetFamily
        .collection("parents")
        .doc(normalizeEmail(parent.id))
      const subscribeToMailingList = legacyBoolean(pdata.subscribeToMailingList)
      if (subscribeToMailingList !== pdata.subscribeToMailingList)
        bump(repairCounts, "parent.subscribeToMailingList string -> boolean")
      await writer.set(targetParent, {
        ...(rewrite(pdata) as Record<string, unknown>),
        ...(subscribeToMailingList !== undefined && {subscribeToMailingList}),
        email,
      })
      await copySubcollections(parent.ref, targetParent)
    }

    // campers — split sensitive fields into private/
    const campers = await family.ref.collection("campers").get()
    for (const camper of campers.docs) {
      bump(sourceCounts, "families/campers")
      await migrateCamper(
        camper,
        targetFamily.collection("campers").doc(camper.id)
      )
    }

    // anything else under the family (none expected) is copied verbatim
    for (const sub of await family.ref.listCollections()) {
      if (sub.id !== "parents" && sub.id !== "campers") {
        await copyCollection(sub, targetFamily.collection(sub.id))
      }
    }
  }
}

async function migrateCamper(
  camper: DocumentSnapshot,
  targetCamper: DocumentReference
) {
  const data = camper.data() ?? {}
  const {medicalConditions, dietAndFoodAllergies, demographics, ...rest} = data

  await writer.set(targetCamper, {
    ...(rewrite(rest) as Record<string, unknown>),
    schemaVersion: SCHEMA_VERSION,
  })

  // If the source already has private/ docs (e.g. migrateToRbac ran against
  // it), copy them first; legacy fields then only fill gaps, never overwrite.
  const [sourceHealth, sourceDemographics] = await Promise.all([
    camper.ref.collection("private").doc("health").get(),
    camper.ref.collection("private").doc("demographics").get(),
  ])
  const privateRef = targetCamper.collection("private")

  const health: Record<string, unknown> = {...(sourceHealth.data() ?? {})}
  for (const field of HEALTH_FIELDS) {
    const legacy =
      field === "medicalConditions" ? medicalConditions : dietAndFoodAllergies
    if (!isNonEmpty(health[field]) && legacy !== undefined)
      health[field] = legacy
  }
  if (Object.keys(health).length > 0) {
    await writer.set(privateRef.doc("health"), health)
  }

  const demo: Record<string, unknown> = {
    ...((isNonEmpty(demographics) ? demographics : {}) as Record<
      string,
      unknown
    >),
    ...(sourceDemographics.data() ?? {}),
  }
  if (Object.keys(demo).length > 0) {
    await writer.set(privateRef.doc("demographics"), demo)
    campersWithDemographics.add(targetCamper.path)
  }

  for (const sub of await camper.ref.listCollections()) {
    if (sub.id !== "private")
      await copyCollection(sub, targetCamper.collection(sub.id))
  }
}

// ---------------------------------------------------------------------------
// camps / registrations
// ---------------------------------------------------------------------------

async function migrateCamps() {
  const camps = await source.collection("camps").get()

  for (const camp of camps.docs) {
    bump(sourceCounts, "camps")
    const targetCamp = target.collection("camps").doc(camp.id)
    // Create-only: once a camps/{year} document exists in v2 the dashboard
    // owns it (dates, fees, caps, remainingSpots, image URLs, toggles).
    if (await existsInTarget(targetCamp)) {
      bump(keptCounts, "camps")
    } else {
      await writer.set(
        targetCamp,
        rewrite(camp.data()) as Record<string, unknown>
      )
    }

    const registrations = await camp.ref.collection("registrations").get()
    console.log(`  camps/${camp.id}: ${registrations.size} registrations`)
    for (const reg of registrations.docs) {
      bump(sourceCounts, "camps/registrations")
      await migrateRegistration(
        reg,
        targetCamp.collection("registrations").doc(reg.id)
      )
    }

    for (const sub of await camp.ref.listCollections()) {
      if (sub.id !== "registrations")
        await copyCollection(sub, targetCamp.collection(sub.id))
    }
  }
}

async function migrateRegistration(
  reg: DocumentSnapshot,
  targetReg: DocumentReference
) {
  const data = reg.data() ?? {}
  const {demographics, ...rest} = data
  const out: Record<string, unknown> = {
    ...(rewrite(rest) as Record<string, unknown>),
    schemaVersion: SCHEMA_VERSION,
  }
  repairRegistrationFields(out)

  const camperRef =
    data.camper instanceof DocumentReference ? data.camper : null
  if (!camperRef) {
    warn(`registration ${reg.ref.path} has no camper ref; familyEmails not set`)
  } else {
    // families/{familyId}/campers/{camperId}
    const familyId = camperRef.path.split("/")[1]
    const emails = familyEmailsById.get(familyId)
    if (emails) {
      out.familyEmails = emails
    } else {
      warn(
        `registration ${reg.ref.path} -> family ${familyId} not found; familyEmails not set`
      )
    }

    // Legacy per-registration demographics: keep the data, but on the camper
    if (isNonEmpty(demographics)) {
      const targetCamperPath = camperRef.path
      if (!campersWithDemographics.has(targetCamperPath)) {
        await writer.set(
          target
            .doc(targetCamperPath)
            .collection("private")
            .doc("demographics"),
          demographics as Record<string, unknown>
        )
        campersWithDemographics.add(targetCamperPath)
        bump(writeCounts, "(registration demographics moved to camper)")
      }
    }
  }

  await writer.set(targetReg, out)
  await copySubcollections(reg.ref, targetReg)
}

// ---------------------------------------------------------------------------
// admins — v1 used Auth custom claims, v2 uses a collection
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set([
  "full_admin",
  "program_admin",
  "program_staff",
  "health_staff",
])

async function migrateAdmins() {
  // email -> admin doc to create
  const entries = new Map<string, Record<string, unknown>>()

  if (adminsSource) {
    // Mirror an existing v2 roster as-is: roles, disabled flags and audit
    // fields are already in v2 shape there.
    console.log(`  roster mirrored from ${ADMINS_FROM_DB}`)
    const roster = await adminsSource.collection("admins").get()
    for (const doc of roster.docs) {
      bump(sourceCounts, "admins")
      entries.set(
        normalizeEmail(doc.id),
        rewrite(doc.data()) as Record<string, unknown>
      )
    }
  } else {
    // Existing admin docs in the source keep their role (if valid)
    const existing = await source.collection("admins").get()
    for (const doc of existing.docs) {
      bump(sourceCounts, "admins")
      const data = doc.data()
      entries.set(normalizeEmail(doc.id), {
        ...data,
        role: VALID_ROLES.has(data.role) ? data.role : "full_admin",
        disabled: data.disabled === true,
        addedBy: data.addedBy ?? "v1-migration",
        addedAt: data.addedAt ?? FieldValue.serverTimestamp(),
      })
    }
  }

  // Auth users carrying the v1 claim become full admins (v1 source only —
  // a mirrored v2 roster is already authoritative). Only consulted while the
  // target has no roster yet: once it does, Admin Management owns it, and a
  // delta sync must not need the Auth API (with user ADC the Identity
  // Toolkit API rejects the call for lack of a quota project).
  if (!adminsSource) {
    const targetRoster = (
      await target.collection("admins").count().get()
    ).data().count
    if (targetRoster > 0) {
      console.log(
        `  target already has ${targetRoster} admins; v1 Auth claims not consulted`
      )
    } else {
      let pageToken: string | undefined
      do {
        const page = await admin.auth(app).listUsers(1000, pageToken)
        for (const user of page.users) {
          if (user.customClaims?.admin !== true || !user.email) continue
          const email = normalizeEmail(user.email)
          if (!entries.has(email)) {
            entries.set(email, {
              role: "full_admin",
              disabled: false,
              addedBy: "v1-migration (auth claim)",
              addedAt: FieldValue.serverTimestamp(),
            })
          }
        }
        pageToken = page.pageToken
      } while (pageToken)
    }
  }

  for (const [email, data] of entries) {
    const ref = target.collection("admins").doc(email)
    ;(plannedPaths["admins"] ??= new Set()).add(ref.path)
    // create-only: a role adjusted in Admin Management must survive re-syncs
    if (APPLY) {
      const snap = await ref.get()
      if (snap.exists) {
        bump(writeCounts, "admins (already present, skipped)")
        continue
      }
      await ref.set(data)
    }
    bump(writeCounts, "admins")
    console.log(`  admin: ${email} (${data.role})`)
  }
}

// ---------------------------------------------------------------------------
// Everything else at the top level
// ---------------------------------------------------------------------------

const HANDLED = new Set(["families", "camps", "admins"])

async function migrateOtherCollections() {
  for (const col of await source.listCollections()) {
    if (HANDLED.has(col.id)) continue
    const createOnly = CREATE_ONLY_COLLECTIONS.has(col.id)
    console.log(
      `  copying ${col.id} ${createOnly ? "(create-only)" : "verbatim"}`
    )
    await copyCollection(col, target.collection(col.id), {createOnly})
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function checkReferences() {
  // In APPLY mode a ref must resolve in the target; in dry-run the best proxy
  // is that it resolves in the source (the target copy would then exist too).
  const db = APPLY ? target : source
  const paths = [...referencedPaths]
  const dangling: string[] = []
  for (let i = 0; i < paths.length; i += 100) {
    const refs = paths.slice(i, i + 100).map((p) => db.doc(p))
    const snaps = await db.getAll(...refs)
    snaps.forEach((s) => {
      if (!s.exists) dangling.push(s.ref.path)
    })
  }
  return dangling
}

async function targetCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const group of Object.keys(plannedPaths)) {
    const id = group.split("/").pop()!
    out[group] = (await target.collectionGroup(id).count().get()).data().count
  }
  return out
}

function printTable(rows: string[][]) {
  const cols = rows[0].length
  const widths = Array.from({length: cols}, (_, i) =>
    Math.max(...rows.map((r) => r[i].length))
  )
  for (const r of rows)
    console.log(
      "  " +
        r
          .map((c, i) => c.padEnd(widths[i]))
          .join("   ")
          .trimEnd()
    )
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"}: ${SOURCE_DB} -> ${TARGET_DB} (project ${app.options.projectId})\n`
  )

  console.log("families / parents / campers")
  await migrateFamilies()
  console.log("camps / registrations")
  await migrateCamps()
  console.log("other collections")
  await migrateOtherCollections()
  console.log("admins")
  await migrateAdmins()
  await writer.flush()

  console.log("\nchecking references…")
  const dangling = await checkReferences()

  console.log(`\nSummary (${APPLY ? "written" : "dry run"}):`)
  const tgt = APPLY ? await targetCounts() : null
  const count = (kind: ChangeKind, group: string) =>
    String(changeCounts[kind][group] ?? 0)
  const rows: string[][] = [
    [
      "collection group",
      "source",
      "compared",
      APPLY ? "created" : "would create",
      APPLY ? "updated" : "would update",
      "unchanged",
      APPLY ? "target now" : "",
    ],
  ]
  const merged: string[] = []
  const groups = [
    ...Object.keys(sourceCounts).sort(),
    ...Object.keys(writeCounts)
      .filter((k) => !(k in sourceCounts))
      .sort(),
  ]
  for (const group of groups) {
    const fromSource = group in sourceCounts
    const planned = plannedPaths[group]?.size ?? 0
    const kept = keptCounts[group] ?? 0
    if (fromSource && planned + kept < sourceCounts[group]) {
      merged.push(
        `${group}: ${sourceCounts[group]} source docs -> ${planned} (IDs normalized to the same path)`
      )
    }
    rows.push([
      group,
      fromSource ? String(sourceCounts[group]) : "-",
      String(planned),
      count("create", group),
      count("update", group),
      count("unchanged", group),
      tgt && plannedPaths[group] ? String(tgt[group] ?? "") : "",
    ])
  }
  printTable(rows)
  merged.forEach((m) => console.log(`  ~ merged: ${m}`))
  for (const [group, n] of Object.entries(keptCounts))
    console.log(
      `  ~ kept: ${group}: ${n} already in the target, left untouched (create-only)`
    )

  const creates = changedDocs.filter((c) => c.kind === "create")
  const updates = changedDocs.filter((c) => c.kind === "update")
  console.log(
    `\nDocuments the merge ${APPLY ? "changed" : "would change"}: ${creates.length} created, ${updates.length} updated`
  )
  const LIST_LIMIT = 60
  for (const c of changedDocs.slice(0, LIST_LIMIT))
    console.log(
      `  ${c.kind === "create" ? "+" : "~"} ${c.path}${
        c.kind === "update" ? `  (${c.fields.join(", ")})` : ""
      }`
    )
  if (changedDocs.length > LIST_LIMIT)
    console.log(`  … and ${changedDocs.length - LIST_LIMIT} more`)

  if (Object.keys(repairCounts).length) {
    console.log(
      "\nLegacy values repaired on the source copies (counted as unchanged when the target was already repaired):"
    )
    for (const [k, n] of Object.entries(repairCounts))
      console.log(`  ${String(n).padStart(5)}  ${k}`)
  }

  if (tgt) {
    const short = Object.keys(sourceCounts).filter(
      (g) => tgt[g] < (plannedPaths[g]?.size ?? 0)
    )
    if (short.length) {
      console.log(`\n✗ target is missing docs in: ${short.join(", ")}`)
    } else {
      console.log("\n✓ every planned document exists in the target")
    }
  }

  console.log(
    `\nReferences: ${referencedPaths.size} rewritten, ${dangling.length} dangling`
  )
  dangling.slice(0, 20).forEach((p) => console.log(`  dangling: ${p}`))
  if (dangling.length > 20) console.log(`  … and ${dangling.length - 20} more`)

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`)
    warnings.slice(0, 30).forEach((w) => console.log(`  ! ${w}`))
    if (warnings.length > 30)
      console.log(`  … and ${warnings.length - 30} more`)
  }

  if (!APPLY)
    console.log(
      "\nDry run complete. Re-run with APPLY=1 to write to the target."
    )
  process.exit(dangling.length > 0 ? 2 : 0)
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
