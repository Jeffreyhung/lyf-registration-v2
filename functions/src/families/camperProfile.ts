import {Camper, Registration} from "lyf-registration-schemas";

/**
 * Pure half of the syncCamperProfile trigger: which camper fields are mirrored
 * onto registrations, whether an update touched any of them, and the exact
 * patch to apply. Kept free of Firestore so it can be unit-tested.
 *
 * Health and demographics are deliberately absent: they live under
 * families/{f}/campers/{c}/private/ so rules can gate them by role, and must
 * never be copied onto a registration (readable by every admin role).
 */

/** Tier-0 camper profile fields denormalized onto every registration. */
export const CAMPER_PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "preferredName",
  "birthDate",
  "gender",
  "pronouns",
] as const;

export type CamperProfileFields = Pick<
  Camper,
  (typeof CAMPER_PROFILE_FIELDS)[number]
>;

/** The registration fields derived from a camper's profile. */
export type CamperProfilePatch = Required<
  Pick<
    Registration,
    "camperName" | "preferredName" | "birthDate" | "gender" | "pronouns"
  >
>;

function sameGender(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/** Whether any of the mirrored profile fields differ between two camper docs. */
export function didCamperProfileChange(
  before: CamperProfileFields,
  after: CamperProfileFields
): boolean {
  return CAMPER_PROFILE_FIELDS.some((field) =>
    field === "gender" ?
      !sameGender(before.gender, after.gender) :
      (before[field] ?? null) !== (after[field] ?? null)
  );
}

/**
 * The registration patch for a camper's current profile. Missing values are
 * normalized the same way createOrUpdateRegistration writes them so a
 * trigger-driven sync and a fresh registration produce identical documents:
 * nullable text (preferredName, pronouns) → null, birthDate → "", gender → [].
 */
export function buildCamperProfilePatch(
  camper: CamperProfileFields
): CamperProfilePatch {
  return {
    camperName: `${camper.firstName ?? ""} ${camper.lastName ?? ""}`.trim(),
    preferredName: camper.preferredName ?? null,
    birthDate: camper.birthDate ?? "",
    gender: camper.gender ?? [],
    pronouns: camper.pronouns ?? null,
  };
}

/**
 * The patch to apply to the camper's registrations after an update, or null
 * when none of the mirrored fields changed.
 */
export function buildCamperProfileUpdate(
  before: CamperProfileFields,
  after: CamperProfileFields
): CamperProfilePatch | null {
  return didCamperProfileChange(before, after) ?
    buildCamperProfilePatch(after) :
    null;
}
