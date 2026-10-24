// The browser SDK is initialised in gatsby-browser.tsx; the CSP report-uri in
// utils/csp.ts is derived from the same DSN so the two can't point at
// different Sentry projects.
export const SENTRY_DSN =
  "https://3414e48dc3888601e6615b647e04b037@o4510758163251200.ingest.us.sentry.io/4510758330499072"

/**
 * Turns a Sentry DSN into the matching CSP `report-uri` endpoint:
 * `https://<key>@<host>/<project>` -> `https://<host>/api/<project>/security/?sentry_key=<key>`
 * Returns null when the DSN doesn't have that shape.
 */
export const sentrySecurityReportUri = (dsn: string): string | null => {
  const match = /^(https?):\/\/([^@/]+)@([^/]+)\/(\d+)\/?$/.exec(dsn.trim())
  if (!match) return null
  const [, scheme, publicKey, host, projectId] = match
  return `${scheme}://${host}/api/${projectId}/security/?sentry_key=${publicKey}`
}
