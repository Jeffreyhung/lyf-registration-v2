/**
 * Seed or overwrite camps/{year} in the *test* database from a JSON file.
 *
 * This is the emergency/bootstrap path. The normal way to create or edit a
 * camp year is the admin dashboard's "Camp Year" tab (full_admin or
 * program_admin), which calls the manageCampYear function so the key
 * whitelist, date-order checks and audit log apply. Use this script only when
 * the dashboard is not an option (e.g. seeding a brand-new test database).
 *
 * Usage:
 *   CAMP_YEAR=2027 CAMP_YEAR_JSON=./camp-years/2027.json ./run.sh -n resetCampYearInfo
 *
 * The JSON file holds the CampYear configuration fields (see
 * CAMP_YEAR_CONFIG_KEYS in the schemas package). Date fields are ISO-8601
 * strings with an offset, e.g. "2027-01-31T12:00:00-08:00". Keys starting
 * with "_" are notes and are ignored. remainingSpots is not read from the
 * file — it is reset to campSizeCaps. registrationBypassEmails is not stored
 * on the camp document: it replaces the private per-email documents under
 * camps/{year}/private/bypass/emails/. scripts/camp-years/ holds one file per
 * year reconstructed from the v1 repository's history.
 */
import {readFileSync} from "fs"
import {resolve} from "path"
import * as admin from "firebase-admin"
import {getFirestore} from "firebase-admin/firestore"
import {
  CAMP_YEAR_CONFIG_KEYS,
  CAMP_YEAR_DATE_KEYS,
  normalizeEmails,
  registrationBypassCollectionPath,
} from "lyf-registration-schemas"
import {FieldValue} from "firebase-admin/firestore"

const app = admin.initializeApp()
// Seeds the v2 test database; "(default)"/"internal-test" belong to v1
const db = getFirestore(
  app,
  process.env.FIRESTORE_TEST_DATABASE_ID ?? "lyf-v2-test"
)

function readConfig(): {year: number; config: Record<string, unknown>} {
  const year = Number(process.env.CAMP_YEAR)
  if (!Number.isInteger(year) || year < 2017) {
    throw new Error("Set CAMP_YEAR to the camp year to write, e.g. CAMP_YEAR=2027")
  }
  const file = process.env.CAMP_YEAR_JSON
  if (!file) {
    throw new Error("Set CAMP_YEAR_JSON to the path of the camp year JSON file")
  }

  const raw = JSON.parse(readFileSync(resolve(file), "utf8")) as Record<string, unknown>
  const allowed = new Set<string>(CAMP_YEAR_CONFIG_KEYS)
  const dateKeys = new Set<string>(CAMP_YEAR_DATE_KEYS)

  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue
    if (!allowed.has(key)) {
      throw new Error(`${key} is not a camp year configuration field`)
    }
    if (dateKeys.has(key)) {
      const date = new Date(value as string)
      if (Number.isNaN(date.getTime())) {
        throw new Error(`${key} must be an ISO-8601 date-time string`)
      }
      config[key] = date
    } else {
      config[key] = value
    }
  }
  return {year, config}
}

async function main() {
  const {year, config} = readConfig()
  const {registrationBypassEmails, ...campFields} = config
  const campSizeCaps = (campFields.campSizeCaps ?? {}) as Record<string, number>

  await db.collection("camps").doc(String(year)).set({
    ...campFields,
    name: campFields.name ?? `LYF Camp ${year}`,
    // Fresh year, fresh spots.
    remainingSpots: {...campSizeCaps},
  })
  console.log(`Wrote camps/${year} with ${Object.keys(campFields).length} fields`)

  // Replace the private bypass entries with the file's list (possibly empty).
  const bypassRef = db.collection(registrationBypassCollectionPath(year))
  const desired = normalizeEmails((registrationBypassEmails as string[] | undefined) ?? [])
  const batch = db.batch()
  for (const existing of await bypassRef.listDocuments()) batch.delete(existing)
  for (const email of desired) {
    batch.set(bypassRef.doc(email), {
      email,
      addedBy: "resetCampYearInfo script",
      addedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  console.log(`Wrote ${desired.length} bypass entries under ${bypassRef.path}`)
}

main()
  .then(() => console.log("Success"))
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
