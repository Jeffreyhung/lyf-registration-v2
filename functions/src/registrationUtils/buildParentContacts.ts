import {Parent, ParentContact, normalizeEmail} from "lyf-registration-schemas";

/**
 * Build the parent contact list denormalized onto a registration for the
 * admin grid (see Registration.parentContacts).
 *
 * The result keeps the payload order, which is the same order as the
 * registration's `familyEmails` (the signed-in parent comes first in both).
 * Duplicate emails are collapsed onto the first occurrence, like
 * normalizeEmails does for `familyEmails`; a parent with no email is kept
 * (they still exist as a parent document keyed by phone number).
 *
 * Missing fields are written as empty strings rather than omitted: Firestore
 * rejects `undefined`, ParentContact's fields are non-optional, and the grid
 * can treat every row the same way.
 */
export function buildParentContacts(parents: Parent[]): ParentContact[] {
  const seenEmails = new Set<string>();
  const contacts: ParentContact[] = [];

  for (const parent of parents) {
    const email = parent.email ? normalizeEmail(parent.email) : "";
    if (email) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
    }
    contacts.push({
      firstName: parent.firstName ?? "",
      lastName: parent.lastName ?? "",
      email,
      phoneNumber: parent.phoneNumber ?? "",
    });
  }

  return contacts;
}
