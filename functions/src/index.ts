import "./instrument";

import {initializeApp} from "firebase-admin/app";
import {setGlobalOptions} from "firebase-functions/v2/options";

// Initialize our app once which allows us to perform Admin SDK operations.
initializeApp();
// Every v2 function deploys to us-west2, the region the website's
// getFunctions() call (website/src/utils/firebaseApp.ts) and the v1 codebase
// use. This used to be SUPPORTED_REGIONS[3], a v1-only export that
// firebase-functions 6+ no longer exposes from the package root.
setGlobalOptions({region: "us-west2"});

// Import our function for handling paid Stripe invoices
import {handleStripeWebhook, handleTestStripeWebhook} from "./stripe/handleStripeWebhook";

// Import our function for create pre-registration sessions.
import {createPreRegistrationSession} from "./preRegistration/createPreRegistrationSession";

// Import our function for creating a registration session.
import {createRegistrationSession} from "./registration/createRegistrationSession";

// Import our function for moving campers off the waitlist
import {moveCampersOffWaitlist} from "./registration/moveCampersOffWaitlist";

// Import our function for issuing a refund for a given Stripe checkout session ID
import {issueStripeRefund} from "./stripe/issueStripeRefund";

// Import our function for managing the admin roster (the only write path to admins/)
import {manageAdmin} from "./admin/manageAdmin";

// Import our function for camp year configuration (the only write path to
// camps/{year} config fields and config/site)
import {manageCampYear} from "./admin/manageCampYear";

// Import our trigger that mirrors the admin roster into the test database
import {replicateAdminsToTest} from "./admin/replicateAdminsToTest";

// Import our triggers that keep Registration.familyEmails in sync with Family.emails
import {
  syncFamilyEmailsOnUpdate,
  syncFamilyEmailsOnUpdateTest,
} from "./families/syncFamilyEmails";

// Import our triggers that keep the camper profile fields denormalized on registrations in sync
import {
  syncCamperProfileOnUpdate,
  syncCamperProfileOnUpdateTest,
} from "./families/syncCamperProfile";

// Deployed names carry a V2 suffix: v1's functions of the same base names still
// run in this project and region, and Cloud Functions names are unique per
// region. The website resolves these through FUNCTION_NAMES in the schemas
// package — keep the two lists in sync.
export {
  handleStripeWebhook as handleStripeWebhookV2,
  handleTestStripeWebhook as handleTestStripeWebhookV2,
  createPreRegistrationSession as createPreRegistrationSessionV2,
  createRegistrationSession as createRegistrationSessionV2,
  moveCampersOffWaitlist as moveCampersOffWaitlistV2,
  issueStripeRefund as issueStripeRefundV2,
  manageAdmin as manageAdminV2,
  manageCampYear as manageCampYearV2,
  replicateAdminsToTest as replicateAdminsToTestV2,
  syncFamilyEmailsOnUpdate as syncFamilyEmailsOnUpdateV2,
  syncFamilyEmailsOnUpdateTest as syncFamilyEmailsOnUpdateTestV2,
  syncCamperProfileOnUpdate as syncCamperProfileOnUpdateV2,
  syncCamperProfileOnUpdateTest as syncCamperProfileOnUpdateTestV2,
};
