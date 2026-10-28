import { CampTrack, SiteConfig } from "./camp"

// ---- manageCampYear callable ----
// camps/{year} and config/site are never written from the client; every
// change goes through the `manageCampYear` Cloud Function so the key
// whitelist (remainingSpots is function-managed), date-order validation and
// the audit log apply to every path. Requires the manageCampYear capability.

/** Timestamp fields on CampYear that the dashboard may set. */
export const CAMP_YEAR_DATE_KEYS = [
  "preRegistrationOpenDate",
  "preRegistrationCloseDate",
  "earlyRegOpenDate",
  "earlyRegEndDate",
  "registrationOpenDate",
  "registrationLateDate",
  "registrationCloseDate",
  "infoSessionDate",
  "campStartDate",
  "campEndDate",
] as const

/** Numeric fee fields (whole dollars). */
export const CAMP_YEAR_FEE_KEYS = [
  "preRegistrationFee",
  "registrationFee",
  "registrationLateFee",
  "shirtPrice",
  "siblingDiscount",
] as const

/** Free-text fields. */
export const CAMP_YEAR_TEXT_KEYS = ["name", "campsite", "campsiteAddress"] as const

/**
 * Every key the callable will accept. remainingSpots is deliberately absent:
 * functions decrement it as campers register and resetting it by hand would
 * let registrations bypass the waitlist. registrationBypassEmails is accepted
 * here but is NOT stored on the camps/{year} document — the function writes
 * one private document per email (see registrationBypassCollectionPath).
 */
export const CAMP_YEAR_CONFIG_KEYS = [
  ...CAMP_YEAR_DATE_KEYS,
  ...CAMP_YEAR_FEE_KEYS,
  ...CAMP_YEAR_TEXT_KEYS,
  "campTotalSizeCap",
  "campSizeCaps",
  "registrationBypassEmails",
] as const

export type CampYearDateKey = (typeof CAMP_YEAR_DATE_KEYS)[number]
export type CampYearFeeKey = (typeof CAMP_YEAR_FEE_KEYS)[number]
export type CampYearTextKey = (typeof CAMP_YEAR_TEXT_KEYS)[number]
export type CampYearConfigKey = (typeof CAMP_YEAR_CONFIG_KEYS)[number]

/**
 * The configuration half of a CampYear as it travels over the callable
 * boundary. Callables are JSON, so dates are ISO-8601 strings (with offset)
 * here and become Timestamps in the function.
 */
export type CampYearConfigInput = Partial<
  Record<CampYearDateKey, string> &
    Record<CampYearFeeKey, number> &
    Record<CampYearTextKey, string> & {
      campTotalSizeCap: number
      campSizeCaps: Record<CampTrack, number>
      registrationBypassEmails: string[]
    }
>

/**
 * Dates that must be in this order when they are all present. Pairs are
 * checked independently so a partially filled year still validates.
 */
export const CAMP_YEAR_DATE_ORDER: ReadonlyArray<
  readonly [CampYearDateKey, CampYearDateKey]
> = [
  ["preRegistrationOpenDate", "preRegistrationCloseDate"],
  ["preRegistrationCloseDate", "earlyRegOpenDate"],
  ["earlyRegOpenDate", "earlyRegEndDate"],
  ["earlyRegOpenDate", "registrationOpenDate"],
  ["registrationOpenDate", "registrationLateDate"],
  ["registrationLateDate", "registrationCloseDate"],
  ["registrationCloseDate", "campStartDate"],
  ["campStartDate", "campEndDate"],
]

export type ManageCampYearAction =
  | "createYear"
  | "updateYear"
  | "setSiteConfig"
  | "copyYearFromProd"
  | "copySiteConfigFromProd"

export type CreateYearRequest = {
  action: "createYear"
  /** The camps/{year} document to create. Fails if it already exists. */
  year: number
  /**
   * Year to copy from. Every Timestamp moves forward by (year - sourceYear)
   * calendar years, remainingSpots resets to campSizeCaps, then `overrides`
   * are applied on top.
   */
  sourceYear: number
  overrides?: CampYearConfigInput
}

export type UpdateYearRequest = {
  action: "updateYear"
  year: number
  /** Only CAMP_YEAR_CONFIG_KEYS are accepted; anything else is rejected. */
  fields: CampYearConfigInput
}

export type SetSiteConfigRequest = {
  action: "setSiteConfig"
  config: Pick<SiteConfig, "currentCampYear" | "preRegistrationCampYear">
}

/**
 * Mirror camps/{year} (configuration, remainingSpots and the private bypass
 * entries) from the production database into the test database. Only valid
 * with isTestData: true; the production database is never written.
 */
export type CopyYearFromProdRequest = {
  action: "copyYearFromProd"
  year: number
}

/** Mirror config/site's year pointers from production into the test database. */
export type CopySiteConfigFromProdRequest = {
  action: "copySiteConfigFromProd"
}

export type ManageCampYearRequest = (
  | CreateYearRequest
  | UpdateYearRequest
  | SetSiteConfigRequest
  | CopyYearFromProdRequest
  | CopySiteConfigFromProdRequest
) & {
  /** Write to the test database instead of prod (mirrors the dashboard toggle). */
  isTestData?: boolean
}

export type ManageCampYearResponse = {
  status: "success"
  action: ManageCampYearAction
  /** Document written: "camps/{year}" or "config/site". */
  target: string
}
