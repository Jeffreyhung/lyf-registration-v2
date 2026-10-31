import * as Sentry from "@sentry/node";
import {addDays} from "date-fns";
import {formatInTimeZone} from "date-fns-tz";
import {logger} from "firebase-functions";
import {onCall} from "firebase-functions/v2/https";
import * as Mustache from "mustache";

import {
  combineNames,
  emailTransport,
  getFirestoreDb,
  getFirstName,
  REGISTRATION_EMAIL,
  sanitizeForEmailHeader,
} from "../utils";
import {
  CampTrack,
  CampYear,
  Registration,
  RegistrationStatus,
  MoveCampersOffWaitlistRequest,
  validateCampYearWrite,
  validateMoveCampersOffWaitlistRequest,
  validateRegistrationWrite,
} from "lyf-registration-schemas";
import {DocumentReference, FieldValue} from "firebase-admin/firestore";
import {applySpotDelta} from "../registrationUtils";
import {getEmailHeaderImageUrl} from "../registrationUtils/emailHeaderImage";
import {loadEmailTemplate} from "../registrationUtils/emailTemplates";
import {sendMessageToRegistrationErrorMessages} from "../slack/slackChannelWebhooks";
import {
  assertAdmin,
  adminCallableOptions,
} from "../utils/auth";
import {withSentryCallable} from "../utils/sentry";
import {parseCallablePayload} from "../utils/validate";

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
    } = parseCallablePayload(
      validateMoveCampersOffWaitlistRequest,
      request.data
    );

    const db = getFirestoreDb(!isTestData);

    const parentFirstNames = combineNames(
      parentNames.map((p) => getFirstName(p))
    );

    // Mark the registration as pending payment so that it passes through our
    // createRegistrationSession function, and reserve its spot now: the admin
    // is explicitly granting one, so decrement the track (flooring at 0) in
    // the same transaction. A registration that already holds a spot is not
    // decremented again (e.g. the button was clicked twice).
    try {
      const campRef = db
        .collection("camps")
        .doc(campYear.toString()) as DocumentReference<CampYear>;
      const registrationRef = campRef
        .collection("registrations")
        .doc(registrationId) as DocumentReference<Registration>;

      await db.runTransaction(async (t) => {
        const campSnapshot = await t.get(campRef);
        const registrationSnapshot = await t.get(registrationRef);
        if (!registrationSnapshot.exists) {
          throw new Error(`Registration ${registrationRef.path} not found`);
        }
        const registration = registrationSnapshot.data();

        t.update(
          registrationRef,
          validateRegistrationWrite({
            status: RegistrationStatus.PENDING_PAYMENT,
            spotReserved: true,
            updatedAt: FieldValue.serverTimestamp(),
          })
        );

        if (registration?.spotReserved === true) return;
        const track = registration?.campTrack ?? (campTrack as CampTrack);
        t.set(
          campRef,
          validateCampYearWrite({
            remainingSpots: applySpotDelta(
              campSnapshot.data()?.remainingSpots,
              track,
              -1
            ),
          }),
          {merge: true}
        );
      });
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
        "EEEE MMM do, y"
      ),
      camperName: camperName,
      campTrack: campTrack,
      emailHeaderImageUrl: await getEmailHeaderImageUrl(db, campYear),
    };

    const htmlBody = Mustache.render(
      loadEmailTemplate("offWaitlistTemplate"),
      templateInput
    );

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
