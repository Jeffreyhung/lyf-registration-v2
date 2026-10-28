import * as Mustache from "mustache";
import {readFileSync} from "fs";
import mjml2html from "mjml";
import {resolve} from "path";
import {Firestore} from "firebase-admin/firestore";

import {Camper, CamperHealth, Registration} from "lyf-registration-schemas";
import {REGISTRATION_EMAIL, emailTransport, sanitizeForEmailHeader} from "../utils";
import {getEmailHeaderImageUrl} from "./emailHeaderImage";

const mjmlTemplate = readFileSync(
  resolve(__dirname, "../emailTemplates/registrationTemplate.mjml"),
  "utf-8"
);

const htmlTemplate = mjml2html(mjmlTemplate, {
  minify: true, // Making it smaller to save on email file size
}).html;

/**
 * Send the registration confirmation email.
 * @param db the database the registration lives in (for the camp document)
 * @param emailToSendTo
 * @param campYear
 * @param camperInfo
 * @param registrationInfo
 * @param camperHealth
 */
export async function sendRegistrationEmail(
  db: Firestore,
  emailToSendTo: string,
  campYear: number,
  camperInfo: Camper,
  registrationInfo: Registration,
  camperHealth: CamperHealth | null
) {
  const camperName = registrationInfo.camperName;
  const htmlBody = Mustache.render(htmlTemplate, {
    campYear: campYear,
    emailHeaderImageUrl: await getEmailHeaderImageUrl(db, campYear),
    campTrack: registrationInfo.campTrack,
    camperName: camperName,
    camperPreferredName: camperInfo.preferredName,
    camperBirthday: camperInfo.birthDate,
    camperGrade: registrationInfo.grade,
    camperGender: camperInfo.gender?.join(", "),
    camperPronouns: camperInfo.pronouns,
    camperTShirtSize: registrationInfo.shirtSize,
    camperCabinPreference: registrationInfo.cabinPreference,
    camperDietFood: camperHealth?.dietAndFoodAllergies,
    camperMedical: camperHealth?.medicalConditions,
    camperAdditionalNotes: registrationInfo.additionalNotes,
  });

  await emailTransport.sendMail({
    from: `TACL-LYF <${REGISTRATION_EMAIL}>`,
    to: emailToSendTo,
    subject: sanitizeForEmailHeader(
      `TACL-LYF Camp ${campYear} Registration Confirmation for ${camperName}`
    ),
    html: htmlBody,
  });
}
