import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://3414e48dc3888601e6615b647e04b037@o4510758163251200.ingest.us.sentry.io/4510758330499072",
  environment: process.env.FUNCTIONS_EMULATOR === "true"
    ? "development"
    : "production",
  // Full tracing is affordable at this service's volume (a few thousand
  // invocations a year) and is what makes a slow checkout debuggable; revisit
  // if the Sentry span quota is ever the constraint.
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
});
