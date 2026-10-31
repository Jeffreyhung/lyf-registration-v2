import * as Sentry from "@sentry/node";
import {logger} from "firebase-functions";
import mailchimp from "@mailchimp/mailchimp_marketing";
import {createHash} from "crypto";

import {RegistrationType} from "../utils";
import {CollectionReference} from "firebase-admin/firestore";
import {CampTrack, Parent} from "lyf-registration-schemas";
import {sendMessageToRegistrationErrorMessages} from "../slack/slackChannelWebhooks";

// Mailchimp
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY as string,
  server: process.env.MAILCHIMP_SERVER as string,
});

export enum MailchimpList {
  GENERAL = "2bd94e4a2c",
  REGISTERED = "7e35c51f18",
  // This one seems to be deleted as of July 2025, so we'll use the same as Reg
  // PRE_REG = "0fc22524d1",
  PRE_REG = REGISTERED,
}

export const getMailchimpList = (regType: RegistrationType) => {
  switch (regType) {
    case RegistrationType.PreRegistration:
      return MailchimpList.PRE_REG;
    case RegistrationType.Registration:
      return MailchimpList.REGISTERED;
    default:
      return MailchimpList.GENERAL;
  }
};

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
    .addListMember(MailchimpList.GENERAL, {
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
 * Add registration tags to a user in our registered mailing list.
 * @param email
 * @param tagsToAdd
 */
export async function addMailchimpTags(
  email: string,
  tagsToAdd: string[],
  regType: RegistrationType
) {
  const hashedEmail = mailchimpSubscriberHash(email);
  const mailingList = getMailchimpList(regType);

  await mailchimp.lists.updateListMemberTags(mailingList, hashedEmail, {
    tags: tagsToAdd.map((tag) => ({
      name: tag,
      status: "active",
    })),
  });
}

/**
 * A wrapper around the above function which just generates the tag given the camp year.
 * @param email
 * @param campYear
 * @param regType
 */
export async function addMailchimpTagForCampYear(
  email: string,
  campYear: number,
  regType: RegistrationType
) {
  await addMailchimpTags(
    email,
    [getMailchimpTag(campYear.toString(), regType)],
    regType
  );
}

/**
 * Remove registration tags from a user in our registered mailing list.
 * @param email
 * @param tagsToRemove
 */
export async function removeMailchimpTags(
  email: string,
  tagsToRemove: string[],
  regType: RegistrationType
) {
  const hashedEmail = mailchimpSubscriberHash(email);
  const mailingList = getMailchimpList(regType);

  await mailchimp.lists.updateListMemberTags(mailingList, hashedEmail, {
    tags: tagsToRemove.map((tag) => ({
      name: tag,
      status: "inactive",
    })),
  });
}

/**
 * A wrapper around the above function which just remove the tag given the camp year.
 * @param email
 * @param campYear
 * @param regType
 */
export async function removeMailchimpTagForCampYear(
  email: string,
  campYear: number,
  regType: RegistrationType
) {
  await removeMailchimpTags(
    email,
    [getMailchimpTag(campYear.toString(), regType)],
    regType
  );
}

/**
 * Add a user to our registered mailing list.
 * @param email
 * @param firstName
 * @param lastName
 */
export async function addMailchimpUserToMailingList(
  email: string,
  firstName: string | null,
  lastName: string | null,
  regType: RegistrationType
) {
  const hashedEmail = mailchimpSubscriberHash(email);
  const mailingList = getMailchimpList(regType);

  try {
    const response = await mailchimp.lists.setListMember(
      mailingList,
      hashedEmail,
      {
        email_address: email,
        merge_fields: {
          FNAME: firstName,
          LNAME: lastName,
        },
        status_if_new: "subscribed",
        status: "subscribed",
      }
    );

    if (response.status == "subscribed" || response.status == 200) {
      logger.info(`Successfully added ${email} to mailing list`);
    } else {
      logger.warn(`Failed to add ${email} to mailing list`, response);
    }
  } catch (e) {
    Sentry.captureException(e);
    logger.error(e);
  }
}

/**
 * Add all parents from the parents collection to a mailing list.
 * @param regType
 * @param parentCollectionRef
 * @param campYear
 */
export async function addParentsToMailchimpList(
  regType: RegistrationType,
  parentCollectionRef: CollectionReference,
  campYear: string,
  campTracks: CampTrack[] = []
) {
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
          lowerCaseEmail,
          firstName,
          lastName,
          regType
        );
      } catch (e) {
        Sentry.captureException(e);
        logger.error(
          `Failed to add user ${lowerCaseEmail} with first name: ${firstName}, last name: ${lastName} to mailing list.`,
          e
        );
        sendMessageToRegistrationErrorMessages(
          `Failed to add user ${lowerCaseEmail} with first name: ${firstName}, last name: ${lastName} to mailing list.`
        );
      }

      const tags = [
        getMailchimpTag(campYear, regType),
        ...campTracks.map((campTrack) =>
          getMailchimpTagForCampTrack(campYear, campTrack)
        ),
      ];
      try {
        await addMailchimpTags(lowerCaseEmail, tags, regType);
      } catch (e) {
        Sentry.captureException(e);
        sendMessageToRegistrationErrorMessages(
          `Failed to add tags to user ${lowerCaseEmail}: ${tags.join(", ")}`
        );
      }
    })
  );
}
