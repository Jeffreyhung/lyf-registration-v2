import { SENTRY_DSN, sentrySecurityReportUri } from "./sentry"

/**
 * Single source of truth for the website's Content Security Policy.
 *
 * The policy is applied in two places that must stay identical:
 *   - a <meta http-equiv="Content-Security-Policy"> tag (gatsby-ssr.tsx). This
 *     is the enforced policy, and the only option on GitHub Pages, which can't
 *     set response headers.
 *   - a Netlify `_headers` file written into public/ at build time
 *     (gatsby-node.ts). It sends the same policy as
 *     Content-Security-Policy-Report-Only with a report-uri, so violations keep
 *     flowing to Sentry, plus the directives a meta tag can't carry
 *     (frame-ancestors).
 *
 * The header used to be hand-written in netlify.toml and fell behind the meta
 * policy, which is why Sentry filled up with CSP reports (inline scripts,
 * apis.google.com, the Firebase auth iframe) for things the enforced policy
 * already allowed. Edit the directives here and both outputs follow.
 *
 * Everything reads process.env lazily: gatsby-node.ts loads .env with dotenv
 * after its imports are evaluated, so module-level reads would miss it.
 */

const emulatorSources = (): string =>
  process.env.GATSBY_USE_EMULATORS === "true"
    ? " http://localhost:9099 http://localhost:8080 http://localhost:5001"
    : ""

// Firebase Auth's popup/redirect sign-in loads helper iframes from the auth
// domain, and the Google provider loads gapi from apis.google.com.
const firebaseAuthDomain = (): string =>
  process.env.GATSBY_FIREBASE_AUTH_DOMAIN || "lyf-registration.firebaseapp.com"

export const buildCspDirectives = (): string[] => [
  "default-src 'self'",
  // 'unsafe-inline': Gatsby bootstraps every page with inline scripts (chunk
  // mapping, page data) that a static host can't nonce or hash.
  // 'unsafe-eval': needed by a dependency in the admin bundle.
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://apis.google.com https://js.stripe.com https://*.sentry.io https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https: blob:",
  `connect-src 'self' https://*.stripe.com https://*.googleapis.com https://*.google.com https://*.firebaseio.com https://*.firebaseapp.com https://*.cloudfunctions.net https://firestore.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.sentry.io https://www.google-analytics.com https://stats.g.doubleclick.net wss://*.firebaseio.com${emulatorSources()}`,
  `frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://accounts.google.com https://${firebaseAuthDomain()}${emulatorSources()}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

/** Value for the <meta http-equiv="Content-Security-Policy"> tag. */
export const buildCspMetaContent = (): string => buildCspDirectives().join("; ")

/**
 * Value for the Content-Security-Policy-Report-Only response header: the meta
 * policy plus the directives browsers ignore in a meta tag.
 */
export const buildCspReportOnlyHeader = (): string => {
  const reportUri = sentrySecurityReportUri(SENTRY_DSN)
  return [
    ...buildCspDirectives(),
    "frame-ancestors 'self'",
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ].join("; ")
}

/** Response headers for hosts that support them (Netlify `_headers`). */
export const buildSecurityHeaders = (): Record<string, string> => ({
  "Content-Security-Policy-Report-Only": buildCspReportOnlyHeader(),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
})
