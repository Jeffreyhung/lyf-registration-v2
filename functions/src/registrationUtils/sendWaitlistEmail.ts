import * as Mustache from "mustache";
import {readFileSync} from "fs";
import mjml2html from "mjml";
import {resolve} from "path";
import {Firestore} from "firebase-admin/firestore";

import {REGISTRATION_EMAIL, emailTransport, sanitizeForEmailHeader} from "../utils";
import {getEmailHeaderImageUrl} from "./emailHeaderImage";

const mjmlTemplate = readFileSync(
  resolve(__dirname, "../emailTemplates/waitlistTemplate.mjml"),
  "utf-8"
);

const htmlTemplate = mjml2html(mjmlTemplate, {
  minify: true, // Making it smaller to save on email file size
}).html;

/**
 * Send the waitlist confirmation email.
 * @param db the database the registration lives in (for the camp document)
 * @param emailToSendTo
 * @param campYear
 * @param campTrack
 * @param camperName
 */
export async function sendWaitlistEmail(
  db: Firestore,
  emailToSendTo: string,
  campYear: number,
  campTrack: string,
  camperName: string
) {
  const htmlBody = Mustache.render(htmlTemplate, {
    campYear: campYear,
    emailHeaderImageUrl: await getEmailHeaderImageUrl(db, campYear),
    campTrack: campTrack,
    camperName: camperName,
  });

  await emailTransport.sendMail({
    from: `TACL-LYF <${REGISTRATION_EMAIL}>`,
    to: emailToSendTo,
    subject: sanitizeForEmailHeader(
      `TACL-LYF Camp ${campYear} Waitlist Confirmation for ${camperName}`
    ),
    html: htmlBody,
  });
}
