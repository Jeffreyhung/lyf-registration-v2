/**
 * Deployed Cloud Function names, as the website calls them.
 *
 * v2 runs in the same Firebase project and region as v1, and Cloud Functions
 * names are unique per region, so every v2 function is deployed with a V2
 * suffix. functions/src/index.ts exports under these exact names — keep the
 * two in sync.
 */
export const FUNCTION_NAMES = {
  createRegistrationSession: "createRegistrationSessionV2",
  createPreRegistrationSession: "createPreRegistrationSessionV2",
  moveCampersOffWaitlist: "moveCampersOffWaitlistV2",
  issueStripeRefund: "issueStripeRefundV2",
  manageAdmin: "manageAdminV2",
  manageCampYear: "manageCampYearV2",
} as const
