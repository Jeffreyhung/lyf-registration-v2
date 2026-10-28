import {Firestore} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {CampYear} from "lyf-registration-schemas";

/**
 * The hero image for the registration emails lives on camps/{year}
 * (`emailHeaderImageUrl`, edited from the Camp Year tab). Returns undefined
 * when the field is unset or empty, or when the read fails, so the MJML
 * templates fall back to their bundled image rather than the email failing.
 * @param db the database the registration lives in
 * @param campYear the camps/{year} document being registered for
 */
export async function getEmailHeaderImageUrl(
  db: Firestore,
  campYear: number | string
): Promise<string | undefined> {
  try {
    const snap = await db.doc(`camps/${campYear}`).get();
    const url = (snap.data() as CampYear | undefined)?.emailHeaderImageUrl;
    return typeof url === "string" && url.trim() !== "" ? url.trim() : undefined;
  } catch (e) {
    logger.warn(`Could not read emailHeaderImageUrl for camps/${campYear}: ${e}`);
    return undefined;
  }
}
