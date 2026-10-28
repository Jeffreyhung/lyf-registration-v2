import {
  ADMIN_ROLES,
  Capability,
  ROLE_CAPABILITIES,
  resolveAdminRole,
  roleHasCapability,
  rolesWithCapability,
} from "../src/admin"

const ALL_CAPABILITIES = Object.keys(
  ROLE_CAPABILITIES.full_admin
) as Capability[]

describe("resolveAdminRole", () => {
  it.each(ADMIN_ROLES)("accepts the known role %s", (role) => {
    expect(resolveAdminRole(role)).toBe(role)
  })

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a typo", "full-admin"],
    ["different casing", "Full_Admin"],
    ["a number", 1],
    ["an object", { role: "full_admin" }],
    ["an array containing a role", ["full_admin"]],
  ])("fails closed on %s", (_label, value) => {
    expect(resolveAdminRole(value)).toBeNull()
  })
})

describe("roleHasCapability", () => {
  it("grants nothing to a missing role", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(roleHasCapability(null, capability)).toBe(false)
      expect(roleHasCapability(undefined, capability)).toBe(false)
    }
  })

  it("grants every capability to full_admin", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(roleHasCapability("full_admin", capability)).toBe(true)
    }
  })

  it("lets program staff write registrations but not read sensitive data", () => {
    expect(roleHasCapability("program_staff", "writeRegistrations")).toBe(true)
    expect(roleHasCapability("program_staff", "readHealth")).toBe(false)
    expect(roleHasCapability("program_staff", "readDemographics")).toBe(false)
    expect(roleHasCapability("program_staff", "manageAdmins")).toBe(false)
  })

  it("lets health staff read health only", () => {
    expect(roleHasCapability("health_staff", "readHealth")).toBe(true)
    for (const capability of ALL_CAPABILITIES.filter((c) => c !== "readHealth")) {
      expect(roleHasCapability("health_staff", capability)).toBe(false)
    }
  })

  it("reserves money, roster, waitlist and test-data powers for full_admin", () => {
    for (const capability of [
      "managePayments",
      "manageCredits",
      "manageAdmins",
      "manageWaitlist",
      "createTestData",
    ] as const) {
      expect(rolesWithCapability(capability)).toEqual(["full_admin"])
    }
  })
})

describe("rolesWithCapability", () => {
  it("lists every role that has the capability, in ADMIN_ROLES order", () => {
    expect(rolesWithCapability("readHealth")).toEqual([
      "full_admin",
      "health_staff",
    ])
    expect(rolesWithCapability("writeRegistrations")).toEqual([
      "full_admin",
      "program_admin",
      "program_staff",
    ])
    expect(rolesWithCapability("manageCampYear")).toEqual([
      "full_admin",
      "program_admin",
    ])
  })

  it("agrees with roleHasCapability for every role and capability", () => {
    for (const capability of ALL_CAPABILITIES) {
      const expected = ADMIN_ROLES.filter((role) =>
        roleHasCapability(role, capability)
      )
      expect(rolesWithCapability(capability)).toEqual(expected)
    }
  })
})

describe("ROLE_CAPABILITIES", () => {
  it("defines the same capability set for every role", () => {
    for (const role of ADMIN_ROLES) {
      expect(Object.keys(ROLE_CAPABILITIES[role]).sort()).toEqual(
        [...ALL_CAPABILITIES].sort()
      )
    }
  })
})
