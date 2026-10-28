/*
 * File containing utility functions for the schema library to
 */

import { CampTrack, CampTrackInfo, CampYear } from "./camp"
import type { Family } from "./families"

/**
 * Current version of the Firestore document schema. Bump when the shape of
 * family/camper/registration documents changes, and stamp it on writes so
 * future migrations can tell document generations apart instead of
 * inferring state from field presence.
 *
 * Version history:
 *   1 (implicit) — 2023-2025 layout: health + demographics inline on camper docs
 *   2 — RBAC revamp: health/demographics moved to private/ sub-documents,
 *       familyEmails denormalized onto registrations, emails normalized lowercase
 *   3 — Admin-grid denormalization: camper profile fields + parentContacts on
 *       registrations; spotReserved capacity flag; new registrations use the
 *       camper id as their document id (camps/{year}/registrations/{camperId})
 */
export const CURRENT_SCHEMA_VERSION = 3

/**
 * Canonical form for emails used as identity keys (family membership,
 * admins/{email} doc IDs, registration familyEmails). Every write and every
 * comparison must go through this so Firestore rules' exact-match `in`
 * checks against request.auth.token.email behave consistently.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeEmails(emails: (string | undefined | null)[]): string[] {
  return [...new Set(emails.filter((e): e is string => !!e).map(normalizeEmail))]
}

/**
 * Whether `email` belongs to `family` on its own account, as opposed to merely
 * having been listed as a co-parent by whoever registered.
 *
 * `Family.emails` is the authorization key for family data, and any parent can
 * put any address in it. So a listing by someone else is not proof of
 * membership: a stranger could otherwise pre-claim an email and have that
 * person's campers, health info and registrations land in a family the
 * stranger can read. A member is established when they created the family,
 * previously confirmed it as theirs, or are its only member (nobody else could
 * have listed them). Anyone else must confirm the family explicitly before
 * the server will register them into it; the website asks, the function
 * enforces, and both use this one rule.
 */
export function isEstablishedFamilyMember(family: Family, email: string): boolean {
  const me = normalizeEmail(email)
  if (family.createdBy && normalizeEmail(family.createdBy) === me) return true
  if (normalizeEmails(family.confirmedEmails ?? []).includes(me)) return true
  const others = normalizeEmails(family.emails ?? []).filter((e) => e !== me)
  return others.length === 0
}

/**
 * Given a camper's grade, return the camp track that they're assigned to
 * @param grade Integer representing the camper's grade
 * @returns CampTrack enum
 */
export function getCampTrack(grade: number): CampTrack {
  return grade <= 7 ? CampTrack.YOUNGER : CampTrack.OLDER
}

export function getRegistrationPrice(
  campYearInfo: CampYear,
  nowInMs: number = Date.now()
): number {
  const { registrationLateDate, registrationFee, registrationLateFee } =
    campYearInfo

  const isLate =
    registrationLateDate && nowInMs > registrationLateDate.toMillis()
  const price =
    isLate && registrationLateFee ? registrationLateFee : registrationFee
  return price ?? 0
}

/**
 * Given a camp year info, return the tracks that are available for that camp
 * @param campYearInfo
 */
export function getCampTracksFromCamp(campYearInfo: CampYear): CampTrackInfo[] {
  const { campSizeCaps, remainingSpots } = campYearInfo

  if (!campSizeCaps || !remainingSpots) {
    return []
  }

  return Object.entries(campSizeCaps).map(([track, cap]) => ({
    track: track as CampTrack,
    cap: cap,
    // Math.max here to ensure we bottom out at 0
    remainingSpots: Math.max(remainingSpots[track as CampTrack] ?? 0, 0),
  }))
}
