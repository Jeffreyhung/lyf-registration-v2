import {IncomingWebhook} from "@slack/client";

export const registrationForCampSlackWebhook = new IncomingWebhook(
  process.env.SLACK_REGISTRATION_WEBHOOK as string
);

/**
 * Slack renders webhook text as mrkdwn: `<...>` is a link or a mention
 * (`<!channel>` pings everyone) and `&` starts an entity. Camper names,
 * parent emails and Stripe descriptions flow into these messages straight
 * from the registration form, so the three characters Slack reserves are
 * escaped before anything is posted. None of our messages use markup.
 * @param text The message as composed by the caller.
 * @returns The same text with Slack's reserved characters escaped.
 */
export function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a message to the #registrations-for-camp Slack Channel
 * @param message
 * @param isTestData
 * @returns
 */
export async function sendMessageToRegistrationForCampChannel(
  message: string,
  isTestData?: boolean
) {
  if (isTestData) {
    return;
  }

  await registrationForCampSlackWebhook.send(escapeSlackText(message));
}

export const registrationErrorMessagesWebhook = new IncomingWebhook(
  process.env.SLACK_ERROR_WEBHOOK as string
);

/**
 * Send a message to the #registration-error-messages Slack Channel
 * @param message
 * @param isTestData
 */
export async function sendMessageToRegistrationErrorMessages(
  message: string,
  isTestData?: boolean
) {
  if (isTestData) {
    return;
  }

  await registrationErrorMessagesWebhook.send(escapeSlackText(message));
}
