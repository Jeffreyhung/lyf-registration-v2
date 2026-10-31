import {
  buildCspDirectives,
  buildCspMetaContent,
  buildCspReportOnlyHeader,
  buildSecurityHeaders,
} from "@utils/csp"
import { SENTRY_DSN, sentrySecurityReportUri } from "@utils/sentry"

const ENV_KEYS = ["GATSBY_USE_EMULATORS", "GATSBY_FIREBASE_AUTH_DOMAIN"]
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  })
})

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  })
})

/** The value of one directive ("script-src ...") in a policy string. */
const directive = (policy: string, name: string) =>
  policy.split("; ").find((d) => d === name || d.startsWith(`${name} `))

describe("sentrySecurityReportUri", () => {
  it("derives the CSP report endpoint from the website DSN", () => {
    expect(sentrySecurityReportUri(SENTRY_DSN)).toBe(
      "https://o4510758163251200.ingest.us.sentry.io/api/4510758330499072/security/?sentry_key=3414e48dc3888601e6615b647e04b037"
    )
  })

  it("tolerates a trailing slash", () => {
    expect(sentrySecurityReportUri("https://key@host.example/123/")).toBe(
      "https://host.example/api/123/security/?sentry_key=key"
    )
  })

  it("returns null for anything that is not a DSN", () => {
    expect(sentrySecurityReportUri("")).toBeNull()
    expect(sentrySecurityReportUri("https://host.example/123")).toBeNull()
    expect(sentrySecurityReportUri("https://key@host.example/abc")).toBeNull()
  })
})

describe("buildCspDirectives", () => {
  it("allows the sources the site actually loads from", () => {
    const policy = buildCspDirectives().join("; ")
    expect(directive(policy, "default-src")).toBe("default-src 'self'")
    expect(directive(policy, "script-src")).toContain("https://js.stripe.com")
    expect(directive(policy, "script-src")).toContain("https://apis.google.com")
    expect(directive(policy, "script-src")).toContain("'unsafe-inline'")
    expect(directive(policy, "connect-src")).toContain(
      "https://firestore.googleapis.com"
    )
    expect(directive(policy, "connect-src")).toContain("https://*.sentry.io")
    expect(directive(policy, "connect-src")).toContain("wss://*.firebaseio.com")
    expect(directive(policy, "frame-src")).toContain("https://js.stripe.com")
    expect(directive(policy, "frame-src")).toContain(
      "https://accounts.google.com"
    )
    expect(directive(policy, "object-src")).toBe("object-src 'none'")
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'")
  })

  it("frames the default Firebase auth domain when none is configured", () => {
    const policy = buildCspDirectives().join("; ")
    expect(directive(policy, "frame-src")).toContain(
      "https://lyf-registration.firebaseapp.com"
    )
  })

  it("frames the configured Firebase auth domain", () => {
    process.env.GATSBY_FIREBASE_AUTH_DOMAIN = "auth.example.org"
    const policy = buildCspDirectives().join("; ")
    expect(directive(policy, "frame-src")).toContain("https://auth.example.org")
    expect(directive(policy, "frame-src")).not.toContain(
      "lyf-registration.firebaseapp.com"
    )
  })

  it("leaves the emulator ports out unless GATSBY_USE_EMULATORS is true", () => {
    expect(buildCspDirectives().join("; ")).not.toContain("localhost")

    process.env.GATSBY_USE_EMULATORS = "false"
    expect(buildCspDirectives().join("; ")).not.toContain("localhost")

    process.env.GATSBY_USE_EMULATORS = "true"
    const policy = buildCspDirectives().join("; ")
    expect(directive(policy, "connect-src")).toContain("http://localhost:8080")
    expect(directive(policy, "connect-src")).toContain("http://localhost:9099")
    expect(directive(policy, "connect-src")).toContain("http://localhost:5001")
    expect(directive(policy, "frame-src")).toContain("http://localhost:9099")
  })

  it("keeps the directives a meta tag cannot carry out of the base policy", () => {
    const policy = buildCspDirectives().join("; ")
    expect(policy).not.toContain("frame-ancestors")
    expect(policy).not.toContain("report-uri")
  })
})

describe("buildCspMetaContent", () => {
  it("is the base policy, semicolon separated, with no report-uri", () => {
    const meta = buildCspMetaContent()
    expect(meta).toBe(buildCspDirectives().join("; "))
    expect(meta).not.toContain("report-uri")
    expect(meta).not.toContain("frame-ancestors")
  })
})

describe("buildCspReportOnlyHeader", () => {
  it("extends the meta policy with frame-ancestors and the Sentry report-uri", () => {
    const header = buildCspReportOnlyHeader()
    expect(header.startsWith(buildCspMetaContent())).toBe(true)
    expect(directive(header, "frame-ancestors")).toBe("frame-ancestors 'self'")
    expect(directive(header, "report-uri")).toBe(
      `report-uri ${sentrySecurityReportUri(SENTRY_DSN)}`
    )
  })
})

describe("buildSecurityHeaders", () => {
  it("sends the report-only CSP plus the usual hardening headers", () => {
    const headers = buildSecurityHeaders()
    expect(Object.keys(headers).sort()).toEqual([
      "Content-Security-Policy-Report-Only",
      "Permissions-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ])
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(
      buildCspReportOnlyHeader()
    )
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN")
  })
})
