import { DocumentReference } from "firebase/firestore"
import type { Registration } from "lyf-registration-schemas"

/**
 * The document references in a camper's `registrations` field.
 *
 * `Camper.registrations` is typed as `DocumentReference<Registration>[]` and
 * everything the app and the Cloud Functions write matches that, but a
 * document edited outside the app (Firestore console, hand-seeded test data)
 * has held a plain string path instead. Reading `.path` off a string gives
 * `undefined`, and `doc(firestore, undefined)` throws "Function doc() cannot
 * be called with an empty path" from inside the campers snapshot handler,
 * which rejected the whole family load and left the registration page
 * loading forever (Sentry LYF-REGISTRATION-1E).
 *
 * A missing field means the camper has never registered. Anything that is
 * not a reference is dropped and reported once per camper, so a malformed
 * entry costs that one registration rather than the page.
 */
export function camperRegistrationRefs(
  registrations: unknown,
  camperPath: string
): DocumentReference<Registration>[] {
  if (registrations === undefined || registrations === null) {
    return []
  }
  if (!Array.isArray(registrations)) {
    console.warn(
      `${camperPath}: registrations is not an array; ignoring the field`
    )
    return []
  }
  const refs = registrations.filter(
    (entry): entry is DocumentReference<Registration> =>
      entry instanceof DocumentReference
  )
  const dropped = registrations.length - refs.length
  if (dropped > 0) {
    console.warn(
      `${camperPath}: ignoring ${dropped} registrations ${
        dropped === 1
          ? "entry that is not a document reference"
          : "entries that are not document references"
      }`
    )
  }
  return refs
}
