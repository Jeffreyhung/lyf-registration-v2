import Stripe from "stripe";
import {getFirestore} from "firebase-admin/firestore";
import {createTransport} from "nodemailer";

// Configuration is read from process.env. The values come from functions/.env,
// which the Firebase CLI applies to the deployed functions' environment and to
// the emulator, so nothing needs to be loaded at runtime.

// Database IDs are configuration, not code: v2 runs in the same Firebase
// project as v1, whose data lives in "(default)" and "internal-test".
export const PROD_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? "lyf-v2";
export const TEST_DATABASE_ID =
  process.env.FIRESTORE_TEST_DATABASE_ID ?? "lyf-v2-test";

export const db = getFirestore(PROD_DATABASE_ID);
export const testDb = getFirestore(TEST_DATABASE_ID);

export const getFirestoreDb = (isProd: boolean) => (isProd ? db : testDb);

// Stripe Utils
export const stripe = new Stripe(process.env.STRIPE_API_KEY as string, {
  apiVersion: "2023-10-16",
});
export const testStripe = new Stripe(
  process.env.STRIPE_TEST_API_KEY as string,
  {
    apiVersion: "2023-10-16",
  }
);
export const stripeEndpointSecret = process.env
  .STRIPE_ENDPOINT_SECRET as string;
export const testStripeEndpointSecret = process.env
  .STRIPE_TEST_ENDPOINT_SECRET as string;

export const getStripe = (isProd: boolean) => (isProd ? stripe : testStripe);

// Stamped into checkout session metadata so each app's webhook can tell its
// own sessions from the other's while v1 and v2 share one Stripe account.
export const STRIPE_APP_TAG = "v2";

// Registration Utils
export const getFirstName = (name: string) => name.split(" ")[0];
export const combineNames = (names: string[]) =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

/** Strip CR/LF to prevent email header injection via user-supplied values. */
export const sanitizeForEmailHeader = (value: string) =>
  value.replace(/[\r\n]/g, " ").trim();

export enum StripeWebhookEventType {
  Registration = 0,
  PreRegistration = 1,
  Donation = 2,
}

export enum RegistrationType {
  PreRegistration = "PreReg",
  Registration = "Reg",
}

export const REGISTRATION_EMAIL = process.env.EMAIL as string;
const EMAIL_CLIENT_ID = process.env.EMAIL_CLIENT_ID as string;
const EMAIL_CLIENT_SECRET = process.env.EMAIL_CLIENT_SECRET as string;
const EMAIL_REFRESH_TOKEN = process.env.EMAIL_REFRESH_TOKEN as string;

export const emailTransport = createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    type: "OAuth2",
    user: REGISTRATION_EMAIL,
    clientId: EMAIL_CLIENT_ID,
    clientSecret: EMAIL_CLIENT_SECRET,
    refreshToken: EMAIL_REFRESH_TOKEN,
  },
});
