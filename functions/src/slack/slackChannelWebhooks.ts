import {logger} from "firebase-functions";

/**
 * Posts a message to a Slack incoming webhook. Incoming webhooks accept a
 * plain JSON `{text}` body, which is all this app ever sends, so the global
 * fetch of Node 18+ replaces the deprecated @slack/client package.
 *
 * The webhook URL is read when a message is sent, not when the module loads,
 * so an unset variable (local emulator, unit tests) degrades to a logged
 * warning instead of failing every function at import time.
 * @param envVar Name of the environment variable holding the webhook URL
 * @param text The message to post
 */
async function postToSlackWebhook(envVar: string, text: string): Promise<void> {
  const url = process.env[envVar];
  if (!url) {
    logger.warn(`${envVar} is not set; dropping a Slack message`);
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({text}),
  });
  if (!response.ok) {
    throw new Error(
      `Slack webhook ${envVar} responded ${response.status}: ${await response.text()}`
    );
  }
}

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

  await postToSlackWebhook(
    "SLACK_REGISTRATION_WEBHOOK",
    escapeSlackText(message)
  );
}

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

  await postToSlackWebhook("SLACK_ERROR_WEBHOOK", escapeSlackText(message));
}
