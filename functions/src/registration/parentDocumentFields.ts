import {Parent, normalizeEmail} from "lyf-registration-schemas";

/**
 * The fields of a parent payload that get written to the parent document.
 *
 * The client only sends the fields the parent filled in, so optional ones such
 * as `lineId` arrive as `undefined`. The Firestore SDK rejects `undefined` as
 * a document value, which used to fail the whole registration. Dropping those
 * keys writes the same thing a merge would have meant anyway: leave the field
 * as it is.
 * @param parent The parent payload from the registration request.
 * @returns The fields to merge into the parent document.
 */
export function parentDocumentFields(parent: Parent): Parent {
  const fields: Parent = {
    email: parent.email ? normalizeEmail(parent.email) : parent.email,
    firstName: parent.firstName,
    lastName: parent.lastName,
    phoneNumber: parent.phoneNumber,
    lineId: parent.lineId,
    subscribeToMailingList: parent.subscribeToMailingList,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Parent;
}
