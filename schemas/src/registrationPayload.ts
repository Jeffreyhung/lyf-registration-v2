// This file contains the schema for the payload the
// client will send to the server.

import { Camper, CamperHealth, Demographics, Family, Parent, HouseholdCulture } from "./families"

import { Registration } from "./camp"

// Last updated for the 2026 camp registration
export type RegistrationData = {
  campYear: number
  family: Family
  parents: Parent[]
  campers: (Camper & CamperHealth & Registration)[]
  demographics: Demographics[]
  donation: number
  household: HouseholdCulture
  // When another parent listed this account on an existing family, the
  // registration flow asks whether that family is really theirs. The id of
  // the family they confirmed goes here; null/undefined means "start my own".
  // The server only honours it for a family the caller is actually listed in.
  joinFamilyId?: string | null
}

export type RegistrationPayload = RegistrationData & {
  // Needed to route the stripe checkout session back to the website
  successUrl: string
  cancelUrl: string
  isTestData?: boolean
  forceWaitlist?: boolean
}

export type RegistrationSessionResponse = {
  status?: string
  code?: number
  message?: string
  sessionId?: string | null
  isWaitlist?: boolean
}
