import {
  DocumentReference,
  FieldValue,
  Firestore,
} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError} from "firebase-functions/v2/https";

// Local imports
import {
  CampYear,
  Camper,
  Family,
  Parent,
  Registration,
  isEstablishedFamilyMember,
  normalizeEmail,
} from "lyf-registration-schemas";

export type RefAndExisting<T> = {
  ref: DocumentReference<T>;
  didExist: boolean;
};

/**
 * Find the family the authenticated caller belongs to, or create a new one.
 *
 * Membership (`Family.emails`) is the only authorization key for family data
 * in firestore.rules, and any parent can list any address as a co-parent. So
 * being listed in a family is not, by itself, proof that the caller belongs
 * there: otherwise anyone could pre-claim a stranger's email and have that
 * person's campers, health info and registrations written into a family the
 * claimant can read. The caller is registered into
 *
 *   1. the family they are an established member of (created it, confirmed
 *      it before, or are its only member — see isEstablishedFamilyMember), or
 *   2. failing that, the family they explicitly confirmed in this request
 *      (`joinFamilyId`), provided they are actually listed in it, or
 *   3. failing that, a brand-new family of their own.
 *
 * Only the verified auth email is used for the lookup, which also prevents
 * the inverse: merging into a victim's family by naming them as a co-parent.
 *
 * @param db The Firestore database to query from.
 * @param authEmail The caller's verified email from Firebase Auth.
 * @param joinFamilyId A family the caller confirmed as theirs, if any.
 */
export async function findOrCreateFamily(
  db: Firestore,
  authEmail: string,
  joinFamilyId?: string | null
): Promise<RefAndExisting<Family>> {
  const callerEmail = normalizeEmail(authEmail);

  const familiesQuery = await db
    .collection("families")
    .where("emails", "array-contains", callerEmail)
    .get();

  const ownFamilies = familiesQuery.docs.filter((familyDoc) =>
    isEstablishedFamilyMember(familyDoc.data() as Family, callerEmail)
  );

  if (ownFamilies.length > 1) {
    logger.error(`More than one family found for auth email: ${callerEmail}`);
    throw new HttpsError(
      "failed-precondition",
      "Multiple families found for your account. Please contact support."
    );
  }

  if (ownFamilies.length === 1) {
    return {ref: ownFamilies[0].ref, didExist: true};
  }

  if (joinFamilyId) {
    const confirmed = familiesQuery.docs.find((d) => d.id === joinFamilyId);
    if (!confirmed) {
      throw new HttpsError(
        "permission-denied",
        "You are not listed as a parent on the family you selected"
      );
    }
    logger.info(`${callerEmail} confirmed family ${joinFamilyId} as theirs`);
    return {ref: confirmed.ref, didExist: true};
  }

  if (familiesQuery.size > 0) {
    logger.info(
      `${callerEmail} is listed in ${familiesQuery.size} family document(s) ` +
        "but has not confirmed any of them; creating a new family"
    );
  }

  return {ref: db.collection("families").doc(), didExist: false};
}

/**
 * Given a parent object and an existing family ref, try to
 * @param familyRef The document reference for a new or existing family
 * @param parent The parent object to get data from.
 */
export async function findOrCreateParent(
  familyRef: DocumentReference<Family>,
  parent: Parent
): Promise<DocumentReference<Parent>> {
  const parentName = `${parent?.firstName} ${parent?.lastName}`;
  if (!parent.email) {
    logger.warn(`No email found with parent: ${parentName}`);
  }

  const parentId = parent.email?.toLowerCase() ?? parent.phoneNumber;

  if (!parentId) {
    const errMsg = `No email or phone number found on the parent ${parentName}`;
    logger.error(errMsg);
    throw new Error(errMsg);
  }

  return familyRef.collection("parents").doc(parentId);
}

/**
 * Given a family and a camper object, either find an existing camper using the ID or name
 * or create a new one
 * @param familyRef The family that this camper is associated with.
 * @param camper The camper data object
 * @returns The camper document reference
 */
export async function findOrCreateCamper(
  familyRef: DocumentReference<Family>,
  camper: Camper
): Promise<DocumentReference<Camper>> {
  const campersInFamilyRef = familyRef.collection("campers");

  if (camper.id) {
    // TODO Check for existence of the camper
    return campersInFamilyRef.doc(camper.id);
  }

  const campersInFamilyQuery = await campersInFamilyRef
    .where("firstName", "==", camper?.firstName)
    .get();

  return campersInFamilyQuery.size == 1
    ? campersInFamilyQuery.docs[0].ref
    : campersInFamilyRef.doc();
}

/**
 * Find or create a new registration for the camper and camp year
 * @param camperRef The camper this registration is associated with
 * @param campRef The document referencing the curren't camp year
 * @returns The registration document reference
 */
export async function findOrCreateRegistration(
  camperRef: DocumentReference<Camper>,
  campRef: DocumentReference<CampYear>
): Promise<RefAndExisting<Registration>> {
  const camperData = (await camperRef.get()).data() as Camper;

  // Each registration's parent is a collection and the collection's parent is a document whose ID is the camp year
  const regRef = camperData?.registrations?.find(
    (regRef) => regRef.parent.parent?.id === campRef.id
  ) as DocumentReference<Registration> | undefined;

  if (regRef) {
    return {
      ref: regRef,
      didExist: true,
    };
  }

  const newRegRef = campRef
    .collection("registrations")
    .doc() as DocumentReference<Registration>;

  await newRegRef.set({
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    isTestData: camperData.isTestData ?? false,
  });

  return {
    ref: newRegRef,
    didExist: false,
  };
}
