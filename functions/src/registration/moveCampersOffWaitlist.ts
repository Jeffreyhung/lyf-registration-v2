import * as Sentry from "@sentry/node";
import {addDays} from "date-fns";
import {formatInTimeZone} from "date-fns-tz";
import {logger} from "firebase-functions";
import {onCall} from "firebase-functions/v2/https";
import * as Mustache from "mustache";
import * as fs from "fs";
import * as path from "path";

import {
  combineNames,
  emailTransport,
  getFirestoreDb,
  getFirstName,
  REGISTRATION_EMAIL,
  sanitizeForEmailHeader,
} from "../utils";
import {
  RegistrationStatus,
  MoveCampersOffWaitlistRequest,
} from "lyf-registration-schemas";
import {getEmailHeaderImageUrl} from "../registrationUtils/emailHeaderImage";
import {sendMessageToRegistrationErrorMessages} from "../slack/slackChannelWebhooks";
import {
  assertAdmin,
  adminCallableOptions,
} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";
import mjml2html from "mjml";

// Ensure that all variables wrapped in {{}} are represented here
type BodyTemplateInput = {
  campYear: number;
  parentNames: string;
  registrationDate: string;
  camperName: string;
  campTrack: string;
  /** camps/{year}.emailHeaderImageUrl; the template falls back when unset. */
  emailHeaderImageUrl: string | undefined;
};

const mjmlTemplate = fs.readFileSync(
  path.resolve(__dirname, "../emailTemplates/offWaitlistTemplate.mjml"),
  {encoding: "utf8"}
);

const htmlTemplate = mjml2html(mjmlTemplate, {
  minify: true, // Making it smalle rto save on email file size
}).html;

/**
 * Moves campers off of the waitlist by marking their registration as pending payment and sending
 * an email to the parent informing their campers are off the waitlist.
 */
export const moveCampersOffWaitlist = onCall<MoveCampersOffWaitlistRequest>(
  adminCallableOptions,
  withSentryCallable("moveCampersOffWaitlist", async (request) => {
    await assertAdmin(request, "manageWaitlist");

    const {
      parentNames,
      parentEmails,
      campYear,
      camperName,
      registrationId,
      campTrack,
      isTestData,
    } = request.data;

    const db = getFirestoreDb(!isTestData);

    const parentFirstNames = combineNames(
      parentNames.map((p) => getFirstName(p))
    );

    // Mark registrations as pending payment so that they'll pass through our createRegistrationSession function.
    try {
      await db
        .doc(`camps/${campYear}/registrations/${registrationId}`)
        .update({status: RegistrationStatus.PENDING_PAYMENT});
    } catch (e) {
      Sentry.captureException(e);
      logger.error(e);
      sendMessageToRegistrationErrorMessages(
        `Failed to move campers off waitlist: ${camperName}`
      );
      return {
        status: "error",
        code: 402,
        message: "Failed to move campers off waitlist",
      };
    }

    // Send moved off waitlist email
    const templateInput: BodyTemplateInput = {
      campYear: campYear,
      parentNames: parentFirstNames,
      registrationDate: formatInTimeZone(
        addDays(new Date(), 7),
        "America/Los_Angeles",
        "EEEE MMM do, Y"
      ),
      camperName: camperName,
      campTrack: campTrack,
      emailHeaderImageUrl: await getEmailHeaderImageUrl(db, campYear),
    };

    const htmlBody = Mustache.render(htmlTemplate, templateInput);

    return emailTransport.sendMail({
      from: `TACL-LYF <${REGISTRATION_EMAIL}>`,
      to: parentEmails,
      subject: sanitizeForEmailHeader(
        `[TACL LYF] Congrats - ${camperName} is off the waitlist! Finish registration now to secure your spot!`
      ),
      html: htmlBody,
    });
  })
);
