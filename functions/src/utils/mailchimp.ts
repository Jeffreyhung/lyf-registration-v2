import * as Sentry from "@sentry/node";
import {logger} from "firebase-functions";
import mailchimp from "@mailchimp/mailchimp_marketing";
import {createHash} from "crypto";

import {RegistrationType} from "../utils";
import {CollectionReference, Firestore} from "firebase-admin/firestore";
import {
  CampTrack,
  CampYear,
  isMailchimpListId,
  Parent,
} from "lyf-registration-schemas";
import {sendMessageToRegistrationErrorMessages} from "../slack/slackChannelWebhooks";

// Mailchimp
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY as string,
  server: process.env.MAILCHIMP_SERVER as string,
});

/**
 * The permanent "TACL-LYF General List" audience. Every other audience is
 * created per camp year by the directors, so its id is configuration on
 * camps/{year}.mailchimpListId (Camp Year tab) rather than a constant here:
 * the registered (7e35c51f18) and pre-registration (0fc22524d1) ids that used
 * to live in this file were deleted in Mailchimp, after which every member
 * and tag call against them failed with "Not Found".
 */
export const MAILCHIMP_GENERAL_LIST_ID = "2bd94e4a2c";

export type MailchimpListChoice = {
  listId: string;
  /**
   * False when camps/{year} has no usable mailchimpListId and the general
   * list is being used instead. Callers tell the directors so the year gets
   * configured; the parents are still captured, with the year tags.
   */
  configured: boolean;
};

/**
 * The audience that parents registering for `campYear` belong in: the one
 * configured on camps/{year}, or the general list when none is set.
 * @param db
 * @param campYear
 */
export async function getMailchimpListForCampYear(
  db: Firestore,
  campYear: string
): Promise<MailchimpListChoice> {
  const snap = await db.collection("camps").doc(campYear).get();
  const listId = (snap.data() as CampYear | undefined)?.mailchimpListId;
  if (isMailchimpListId(listId)) {
    return {listId, configured: true};
  }
  if (listId) {
    logger.warn(
      `camps/${campYear}.mailchimpListId is not a Mailchimp audience id; ` +
        "using the general list"
    );
  }
  return {listId: MAILCHIMP_GENERAL_LIST_ID, configured: false};
}

export const getMailchimpTag = (campYear: string, regType: RegistrationType) =>
  `${campYear}${regType}`;

/**
 * Mailchimp addresses list members by the MD5 hash of the lowercased email
 * (the "subscriber hash"). Node's crypto module computes it; no package needed.
 * @param email
 */
export const mailchimpSubscriberHash = (email: string) =>
  createHash("md5").update(email.toLowerCase()).digest("hex");

export const getMailchimpTagForCampTrack = (
  campYear: string,
  campTrack: string
) => `${campYear}${campTrack}CampTrack`;

/**
 * Subscribe an email to our Mailchimp TACL-LYF General Mailing List.
 * @param email
 * @param firstName
 * @param lastName
 */
export function subscribeEmailToGeneralMailingList(
  email: string,
  firstName: string | null,
  lastName: string | null
) {
  mailchimp.lists
    .addListMember(MAILCHIMP_GENERAL_LIST_ID, {
      merge_fields: {
        FNAME: firstName,
        LNAME: lastName,
      },
      email_address: email.toLowerCase(),
      status: "subscribed",
    })
    .then(() =>
      logger.debug(`Successfully subscribed ${email} to mailing list`)
    )
    .catch(() =>
      logger.warn(
        `Failed to subscribe ${email} to mailing list because they are already subscribed.`
      )
    );
}

/**
 * Add tags to a member of a mailing list.
 * @param listId
 * @param email
 * @param tagsToAdd
 */
export async function addMailchimpTags(
  listId: string,
  email: string,
  tagsToAdd: string[]
) {
  const hashedEmail = mailchimpSubscriberHash(email);

  await mailchimp.lists.updateListMemberTags(listId, hashedEmail, {
    tags: tagsToAdd.map((tag) => ({
      name: tag,
      status: "active",
    })),
  });
}

/**
 * A wrapper around the above function which just generates the tag given the camp year.
 * @param db
 * @param email
 * @param campYear
 * @param regType
 */
export async function addMailchimpTagForCampYear(
  db: Firestore,
  email: string,
  campYear: number,
  regType: RegistrationType
) {
  const {listId} = await getMailchimpListForCampYear(db, campYear.toString());
  await addMailchimpTags(listId, email, [
    getMailchimpTag(campYear.toString(), regType),
  ]);
}

/**
 * Remove tags from a member of a mailing list.
 * @param listId
 * @param email
 * @param tagsToRemove
 */
export async function removeMailchimpTags(
  listId: string,
  email: string,
  tagsToRemove: string[]
) {
  const hashedEmail = mailchimpSubscriberHash(email);

  await mailchimp.lists.updateListMemberTags(listId, hashedEmail, {
    tags: tagsToRemove.map((tag) => ({
      name: tag,
      status: "inactive",
    })),
  });
}

/**
 * A wrapper around the above function which just remove the tag given the camp year.
 * @param db
 * @param email
 * @param campYear
 * @param regType
 */
export async function removeMailchimpTagForCampYear(
  db: Firestore,
  email: string,
  campYear: number,
  regType: RegistrationType
) {
  const {listId} = await getMailchimpListForCampYear(db, campYear.toString());
  await removeMailchimpTags(listId, email, [
    getMailchimpTag(campYear.toString(), regType),
  ]);
}

/**
 * Add a user to a mailing list (or re-subscribe them if they are already on it).
 * @param listId
 * @param email
 * @param firstName
 * @param lastName
 */
export async function addMailchimpUserToMailingList(
  listId: string,
  email: string,
  firstName: string | null,
  lastName: string | null
) {
  const hashedEmail = mailchimpSubscriberHash(email);

  try {
    const response = await mailchimp.lists.setListMember(listId, hashedEmail, {
      email_address: email,
      merge_fields: {
        FNAME: firstName,
        LNAME: lastName,
      },
      status_if_new: "subscribed",
      status: "subscribed",
    });

    if (response.status == "subscribed" || response.status == 200) {
      logger.info(`Successfully added ${email} to mailing list ${listId}`);
    } else {
      logger.warn(`Failed to add ${email} to mailing list ${listId}`, response);
    }
  } catch (e) {
    Sentry.captureException(e);
    logger.error(e);
  }
}

/**
 * Add all parents from the parents collection to the camp year's mailing
 * list, tagged with the year, the registration type and the camp tracks.
 *
 * Never rejects because of Mailchimp itself: each failure is reported to
 * Sentry and the error channel and the next parent is still processed, so a
 * paid registration is not rolled back over a mailing-list hiccup.
 * @param db
 * @param regType
 * @param parentCollectionRef
 * @param campYear
 * @param campTracks
 * @param isTestData Routes the error-channel messages to the test channel.
 */
export async function addParentsToMailchimpList(
  db: Firestore,
  regType: RegistrationType,
  parentCollectionRef: CollectionReference,
  campYear: string,
  campTracks: CampTrack[] = [],
  isTestData = false
) {
  const {listId, configured} = await getMailchimpListForCampYear(db, campYear);
  if (!configured) {
    const message =
      `camps/${campYear} has no Mailchimp audience configured, so this ` +
      `registration's parents were added to the general list (${listId}) ` +
      `with the ${campYear} tags. Set "Mailchimp audience ID" for ${campYear} ` +
      "in the admin dashboard's Camp Year tab.";
    logger.warn(message);
    sendMessageToRegistrationErrorMessages(message, isTestData);
  }

  const parentDocs = await parentCollectionRef.listDocuments();
  await Promise.all(
    parentDocs.map(async (parent) => {
      const parentData = (await parent.get()).data() as Parent;
      const {email, firstName, lastName} = parentData;
      if (!email || !firstName || !lastName) {
        return;
      }
      const lowerCaseEmail = email.toLowerCase();

      // Create or set the mailchimp user to subscribed
      try {
        await addMailchimpUserToMailingList(
          listId,
          lowerCaseEmail,
          firstName,
          lastName
        );
      } catch (e) {
        Sentry.captureException(e);
        logger.error(
          `Failed to add user ${lowerCaseEmail} with first name: ${firstName}, last name: ${lastName} to mailing list ${listId}.`,
          e
        );
        sendMessageToRegistrationErrorMessages(
          `Failed to add user ${lowerCaseEmail} with first name: ${firstName}, last name: ${lastName} to mailing list ${listId}.`,
          isTestData
        );
      }

      const tags = [
        getMailchimpTag(campYear, regType),
        ...campTracks.map((campTrack) =>
          getMailchimpTagForCampTrack(campYear, campTrack)
        ),
      ];
      try {
        await addMailchimpTags(listId, lowerCaseEmail, tags);
      } catch (e) {
        Sentry.captureException(e);
        sendMessageToRegistrationErrorMessages(
          `Failed to add tags to user ${lowerCaseEmail} in list ${listId}: ${tags.join(", ")}`,
          isTestData
        );
      }
    })
  );
}
