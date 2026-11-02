// Neutral timestamp shape so this package works with both the client SDK
// ("firebase/firestore") and the admin SDK ("firebase-admin/firestore"),
// whose Timestamp classes are distinct types with the same structure.
export type TimestampLike = {
  seconds: number
  nanoseconds: number
  toDate(): Date
  toMillis(): number
}

export const ADMIN_ROLES = [
  "full_admin",
  "program_admin",
  "program_staff",
  "health_staff",
] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]

// Stored at: admins/{email}
export type Admin = Partial<{
  role: AdminRole
  addedBy: string
  addedAt: TimestampLike
  // Prefer disabling over deleting so addedBy/addedAt history survives.
  disabled: boolean
}>

/**
 * The single source of truth for what each role can do.
 *
 * Functions and the website check capabilities through this map instead of
 * comparing role names, so adding a role or capability is a change here plus
 * firestore.rules (which cannot import TS — keep its role checks mirrored
 * with this map, enforced by the rules unit tests).
 */
export const ROLE_CAPABILITIES = {
  // Everything, including the admin roster and unrestricted Firestore writes.
  full_admin: {
    readHealth: true,
    readDemographics: true,
    writeRegistrations: true,
    managePayments: true,
    manageCredits: true,
    manageAdmins: true,
    manageWaitlist: true,
    createTestData: true,
    manageCampYear: true,
  },
  // full_admin minus the admin roster. Sees health data and runs the yearly
  // camp-year rollover. Firestore writes stay operational (same field list as
  // program_staff): creating or deleting families, campers and registrations
  // from the client remains full_admin only.
  program_admin: {
    readHealth: true,
    readDemographics: true,
    writeRegistrations: true,
    managePayments: true,
    manageCredits: true,
    manageAdmins: false,
    manageWaitlist: true,
    createTestData: true,
    manageCampYear: true,
  },
  // Day-to-day operations: everything except health data, the camp-year
  // rollover and the admin roster.
  program_staff: {
    readHealth: false,
    readDemographics: true,
    writeRegistrations: true,
    managePayments: true,
    manageCredits: true,
    manageAdmins: false,
    manageWaitlist: true,
    createTestData: true,
    manageCampYear: false,
  },
  // Read-only view of everything, including health data.
  health_staff: {
    readHealth: true,
    readDemographics: true,
    writeRegistrations: false,
    managePayments: false,
    manageCredits: false,
    manageAdmins: false,
    manageWaitlist: false,
    createTestData: false,
    manageCampYear: false,
  },
} as const satisfies Record<AdminRole, Record<string, boolean>>

export type Capability = keyof (typeof ROLE_CAPABILITIES)["full_admin"]

/**
 * Parse a role value read from Firestore. Fails closed: anything that isn't
 * a known role (missing field, typo, wrong type) resolves to null, never to
 * a privileged default.
 */
export function resolveAdminRole(value: unknown): AdminRole | null {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : null
}

export function roleHasCapability(
  role: AdminRole | null | undefined,
  capability: Capability
): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role][capability]
}

/** All roles granted a capability — useful for error messages and rules mirrors. */
export function rolesWithCapability(capability: Capability): AdminRole[] {
  return ADMIN_ROLES.filter((role) => ROLE_CAPABILITIES[role][capability])
}

// ---- manageAdmin callable ----
// Roster changes are never written from the client; they go through the
// `manageAdmin` Cloud Function so the last-full_admin guard and audit log
// apply to every path.

export type ManageAdminAction = "add" | "setRole" | "setDisabled" | "remove"

export type ManageAdminRequest = {
  action: ManageAdminAction
  email: string
  /** Required for "add" and "setRole" */
  role?: AdminRole
  /** Required for "setDisabled" */
  disabled?: boolean
}

export type ManageAdminResponse = {
  status: "success"
  action: ManageAdminAction
  email: string
}

// Stored at: adminAuditLog/{autoId} — append-only, server-written
export type AdminAuditLogEntry = {
  actor: string
  action: ManageAdminAction
  target: string
  before: Admin | null
  after: Admin | null
  at: TimestampLike
}

// Also stored at: adminAuditLog/{autoId}, written by the manageCampYear
// callable. `target` is the document path ("camps/2027", "config/site") and
// `database` says which data set (prod or test) the write went to.
export type CampYearAuditLogEntry = {
  actor: string
  action:
    | "createYear"
    | "updateYear"
    | "setSiteConfig"
    | "copyYearFromProd"
    | "copySiteConfigFromProd"
  target: string
  database: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  at: TimestampLike
}

export type AuditLogEntry = AdminAuditLogEntry | CampYearAuditLogEntry
