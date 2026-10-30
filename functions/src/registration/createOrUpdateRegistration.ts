import {
  DocumentReference,
  FieldValue,
  Firestore,
} from "firebase-admin/firestore";
import {
  Camper,
  CampYear,
  Demographics,
  Family,
  HouseholdCulture,
  Parent,
  Registration,
  RegistrationPayload,
  RegistrationStatus,
  getCampTrack,
  CampTrack,
  CURRENT_SCHEMA_VERSION,
  normalizeEmail,
  normalizeEmails,
  validateCamperHealthWrite,
  validateCamperWrite,
  validateCampYearWrite,
  validateDemographicsWrite,
  validateFamilyWrite,
  validateParentWrite,
  validateRegistrationWrite,
} from "lyf-registration-schemas";
import {
  buildParentContacts,
  decideAdmissions,
  findOrCreateCamper,
  findOrCreateFamily,
  findOrCreateParent,
  findOrCreateRegistration,
} from "../registrationUtils";
import {assertCallerEmailInList} from "../utils/auth";
import {parentDocumentFields} from "./parentDocumentFields";

type CamperAndStatus = {
  camperName: string;
  campTrack: CampTrack;
  isWaitlisted: boolean;
  status: RegistrationStatus;
  registrationRef: DocumentReference<Registration>;
};

type PreparedCamper = {
  camperRef: DocumentReference<Camper>;
  registrationRef: DocumentReference<Registration>;
  camperAndRegInfo: CamperAndRegInfo;
  campTrack: CampTrack;
  camperName: string;
};

export type RegistrationReferences = {
  familyRef: DocumentReference<Family>;
  parentRefs: DocumentReference<Parent>[];
  camperAndStatuses: CamperAndStatus[];
};

type CamperAndRegInfo = RegistrationPayload["campers"][0];

/**
 * Given a family payload, update the family and return the reference to it.
 * @param db
 * @param familyPayload
 * @param emails Normalized parent emails from the payload (includes the caller).
 * @param householdCulture
 * @param authEmail The caller's verified email from Firebase Auth.
 * @param joinFamilyId A family the caller confirmed as theirs, if any.
 * @returns
 */
async function updateAndGetFamily(
  db: Firestore,
  familyPayload: Family,
  emails: string[],
  householdCulture: HouseholdCulture,
  authEmail: string,
  joinFamilyId?: string | null
): Promise<DocumentReference<Family>> {
  const callerEmail = normalizeEmail(authEmail);
  const {ref: familyRef, didExist} = await findOrCreateFamily(
    db,
    authEmail,
    joinFamilyId
  );
  await familyRef.set(
    validateFamilyWrite({
      emails: FieldValue.arrayUnion(...emails),
      // The caller registered through this family themselves, so from now on
      // it is theirs without asking (see isEstablishedFamilyMember). Only the
      // caller is confirmed; co-parents they list still have to confirm.
      confirmedEmails: FieldValue.arrayUnion(callerEmail),
      household: householdCulture,
      city: familyPayload.city,
      state: familyPayload.state,
      zip: familyPayload.zip,
      street: familyPayload.street,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      // Stamp the creator once so findOrCreateFamily can tell this family
      // apart from one the caller was merely listed in by someone else.
      ...(didExist ? {} : {createdBy: callerEmail}),
    }),
    {
      merge: true,
    }
  );

  return familyRef;
}

/**
 * Given a parent payload, update each parent and return the references to them.
 * @param db
 * @param familyRef
 * @param parentsPayload
 * @returns
 */
async function updateAndGetParents(
  db: Firestore,
  familyRef: DocumentReference<Family>,
  parentsPayload: Parent[]
): Promise<DocumentReference<Parent>[]> {
  const parentRefs: DocumentReference<Parent>[] = [];
  await Promise.all(
    parentsPayload.map(async (parent) => {
      const parentRef = await findOrCreateParent(familyRef, parent);
      parentRefs.push(parentRef);
      // parentDocumentFields drops undefined keys (the SDK rejects them);
      // the validator then checks what is actually written.
      await parentRef.set(validateParentWrite(parentDocumentFields(parent)), {
        merge: true,
      });
    })
  );

  return parentRefs;
}

/**
 * Given a camper payload, update the camper base doc and write health/demographics
 * to private sub-documents for RBAC-gated access.
 */
async function updateAndGetCamper(
  familyRef: DocumentReference<Family>,
  camperAndRegInfo: CamperAndRegInfo,
  demographics: Demographics
): Promise<DocumentReference<Camper>> {
  const camperRef = await findOrCreateCamper(familyRef, camperAndRegInfo);

  // Base camper doc — accessible to all admin roles
  await camperRef.set(
    validateCamperWrite({
      firstName: camperAndRegInfo.firstName,
      lastName: camperAndRegInfo.lastName,
      preferredName: camperAndRegInfo.preferredName ?? null,
      birthDate: camperAndRegInfo.birthDate,

      gender: camperAndRegInfo.gender,
      pronouns: camperAndRegInfo.pronouns ?? null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }),
    {
      merge: true,
    }
  );

  // Private health sub-doc — accessible to health_staff and full_admin
  const healthRef = camperRef.collection("private").doc("health");
  await healthRef.set(
    validateCamperHealthWrite({
      dietAndFoodAllergies: camperAndRegInfo.dietAndFoodAllergies ?? null,
      medicalConditions: camperAndRegInfo.medicalConditions ?? null,
    }),
    {merge: true}
  );

  // Private demographics sub-doc — accessible to full_admin only
  const demographicsRef = camperRef.collection("private").doc("demographics");
  await demographicsRef.set(validateDemographicsWrite(demographics), {
    merge: true,
  });

  return camperRef;
}

/**
 * Either create new family, camper, or registration references
 * or update the existing ones.
 *
 * The family, parent and camper upserts are plain writes. The registration
 * writes and the capacity decision happen together in ONE transaction: it
 * reads the camp year's remaining spots and every camper's existing
 * registration, decides per camper (see decideAdmissions), writes each
 * registration with its status and `spotReserved`, and decrements
 * `remainingSpots` by the number admitted. Reserving the spot here, rather
 * than when payment lands minutes later, closes the oversubscription window
 * between two families reading the same stale count.
 *
 * @param registrationPayload The client-provided registration information.
 * @param forceWaitlist Staff flag that waitlists every camper regardless of capacity.
 * @param authEmail The caller's verified email from Firebase Auth.
 */
export async function createOrUpdateRegistration(
  db: Firestore,
  registrationPayload: RegistrationPayload,
  forceWaitlist: boolean,
  authEmail: string
): Promise<RegistrationReferences> {
  // TODO: Add HouseholdCulture property here to update into firebase for each family
  const {
    campYear,
    family,
    parents,
    campers,
    demographics,
    household,
    joinFamilyId,
  } = registrationPayload;

  const campRef = db
    .collection("camps")
    .doc(campYear.toString()) as DocumentReference<CampYear>;

  // Normalize at the boundary: family membership emails are identity keys
  // compared verbatim against request.auth.token.email in firestore.rules.
  const emails = normalizeEmails(parents.map((p) => p.email));

  assertCallerEmailInList(authEmail, emails);

  // Update the family, parents, and campers according to the payload.
  const familyRef = await updateAndGetFamily(
    db, family, emails, household, authEmail, joinFamilyId
  );
  const parentRefs = await updateAndGetParents(db, familyRef, parents);
  const parentContacts = buildParentContacts(parents);

  // Update each camper and make sure a registration document exists for them.
  // Order is preserved so decisions can be matched back by index.
  const prepared: PreparedCamper[] = await Promise.all(
    campers.map(async (camperAndRegInfo, index) => {
      const camperRef = await updateAndGetCamper(
        familyRef,
        camperAndRegInfo,
        demographics[index]
      );
      const {ref: registrationRef} = await findOrCreateRegistration(
        camperRef,
        campRef
      );
      return {
        camperRef,
        registrationRef,
        camperAndRegInfo,
        campTrack: getCampTrack(camperAndRegInfo.grade ?? 4),
        camperName: `${camperAndRegInfo?.firstName} ${camperAndRegInfo?.lastName}`,
      };
    })
  );

  // Decide admission and write the registrations atomically against the
  // camp's remaining spots. Firestore requires every transactional read to
  // happen before the first write.
  // NOTE: it's possible we could have only one remaining spot but two campers we're registering here.
  // In this scenario, we want to ensure both campers in the family can register, and we'll have one or two additional
  // capacity. This is an edge case where we hope that other campers will end up cancelling (see decideAdmissions).
  const decisions = await db.runTransaction(async (t) => {
    const campSnapshot = await t.get(campRef);
    const registrationSnapshots =
      prepared.length > 0 ?
        await t.getAll(...prepared.map((p) => p.registrationRef)) :
        [];

    const {decisions, remainingSpots, changed} = decideAdmissions(
      prepared.map((p, i) => ({
        key: p.registrationRef.path,
        campTrack: p.campTrack,
        existingStatus: registrationSnapshots[i]?.data()?.status,
        existingSpotReserved: registrationSnapshots[i]?.data()?.spotReserved,
      })),
      campSnapshot.data()?.remainingSpots,
      forceWaitlist
    );

    prepared.forEach((p, i) => {
      const decision = decisions[i];
      const {camperAndRegInfo} = p;
      t.set(
        p.registrationRef,
        validateRegistrationWrite({
          camperName: p.camperName,
          camper: p.camperRef,
          campTrack: p.campTrack,

          grade: camperAndRegInfo.grade,
          status: decision.status,
          // Left alone for registrations already past the hold stage.
          ...(decision.spotReserved === undefined ?
            {} :
            {spotReserved: decision.spotReserved}),
          shirtSize: camperAndRegInfo.shirtSize,
          isReturning: camperAndRegInfo?.isReturning ?? false,
          cabinPreference: camperAndRegInfo?.cabinPreference ?? "",

          // createdAt already set
          updatedAt: FieldValue.serverTimestamp(),
          waitlistTime: FieldValue.serverTimestamp(),

          // payments not updated yet

          additionalNotes: camperAndRegInfo?.additionalNotes ?? null,
          // internalNotes not set here

          waiverFullName: camperAndRegInfo?.waiverFullName ?? "",
          waiverSignature: camperAndRegInfo?.waiverSignature ?? "",
          waiverSignDate: camperAndRegInfo?.waiverSignDate ?? "",

          // Denormalized for the admin grid (schemaVersion 3). Same
          // normalization as the camper doc / syncCamperProfile: nullable
          // text → null, birthDate → "", gender → []. Health and
          // demographics are deliberately NOT copied here (private/, role-gated).
          firstName: camperAndRegInfo.firstName ?? "",
          lastName: camperAndRegInfo.lastName ?? "",
          preferredName: camperAndRegInfo.preferredName ?? null,
          birthDate: camperAndRegInfo.birthDate ?? "",
          gender: camperAndRegInfo.gender ?? [],
          pronouns: camperAndRegInfo.pronouns ?? null,
          parentContacts: parentContacts,

          familyEmails: emails,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
        {
          merge: true,
        }
      );
    });

    if (changed) {
      t.set(campRef, validateCampYearWrite({remainingSpots}), {merge: true});
    }

    return decisions;
  });

  // Link the registration to the camper (no-op if it is already there).
  await Promise.all(
    prepared.map((p) =>
      p.camperRef.update(
        validateCamperWrite({
          registrations: FieldValue.arrayUnion(p.registrationRef),
        })
      )
    )
  );

  // camperAndStatuses lets the caller build the Stripe checkout session.
  const camperAndStatuses: CamperAndStatus[] = prepared.map((p, i) => ({
    camperName: p.camperName,
    campTrack: p.campTrack,
    isWaitlisted: decisions[i].isWaitlisted,
    status: decisions[i].status,
    registrationRef: p.registrationRef,
  }));

  return {
    familyRef: familyRef,
    parentRefs: parentRefs,
    camperAndStatuses: camperAndStatuses,
  };
}
