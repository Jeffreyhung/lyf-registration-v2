import { DocumentReference } from "firebase/firestore"

import { Capability } from "./admin"
import { Registration } from "./camp"

// Every type is defined with Partial since there's no strict schema in Firebase.
// Instead, every field is optional so these schemas are more of a guide.

// Families in Firebase are represented as a document with sub-collections for parents and campers.
// Hence why we don't link to campers or families here.
export type Family = Partial<{
  city: string
  // All of the emails that have admin access to this family.
  emails: string[]
  // Normalized email of the account whose registration created this family.
  // Set once by the registration function and never client-writable.
  createdBy: string
  // Members who have registered through this family themselves (the creator,
  // and any co-parent who confirmed it is their household). Being in `emails`
  // alone means someone *listed* you; being here means you accepted. See
  // isEstablishedFamilyMember in utils.ts. Function-managed, never client-writable.
  confirmedEmails: string[]
  country: string
  state: string
  street: string
  suite: string | null
  zip: string
  // Culture within each household
  household: HouseholdCulture

  // Test Data
  isTestData: boolean

  // See CURRENT_SCHEMA_VERSION in utils.ts
  schemaVersion: number
}>

export type Parent = Partial<{
  email: string
  firstName: string
  lastName: string
  lineId: string | null
  phoneNumber: string | null
  subscribeToMailingList: boolean
  stripeCustomerId: string
}>

export type Camper = Partial<{
  id: string
  firstName: string
  lastName: string
  preferredName: string | null
  birthDate: string

  gender: string[]
  pronouns: string | null

  registrations: DocumentReference<Registration>[]

  // Test Data
  isTestData: boolean

  // See CURRENT_SCHEMA_VERSION in utils.ts
  schemaVersion: number
}>

// Sensitive camper data lives in sub-documents at
// families/{familyId}/campers/{camperId}/private/{section}.
// This maps each section to the capability required to read it; adding a new
// sensitive category means adding a section here (plus its type) and
// mirroring the gate in firestore.rules — nothing else.
export const PRIVATE_SECTIONS = {
  health: "readHealth",
  demographics: "readDemographics",
} as const satisfies Record<string, Capability>

export type PrivateSection = keyof typeof PRIVATE_SECTIONS

// Stored at: families/{familyId}/campers/{camperId}/private/health
// Access: roles with the "readHealth" capability
export type CamperHealth = Partial<{
  dietAndFoodAllergies: string | null
  medicalConditions: string | null
}>

// Stored at: families/{familyId}/campers/{camperId}/private/demographics
// Access: roles with the "readDemographics" capability
export type Demographics = Partial<{
  born: string
  ethnicity: string[]
  generation: string
  hakkaLanguage: string
  hokkienLanguage: string
  mandarinLanguage: string
  otherBackground: string | null
  otherLanguage: string | null
  immediateFamily: string
}>

// # Make these questions into options - multi-select / radio buttons
// 1. Camper message as part of culture activity / programming
// 2. How often is heritage language (Mandarin/Taiwanese Hokkien ) used at home
// 3. Confidence and familiarity in Taiwanese culture to share with kids
// 4. Interests in learning about Taiwanese culture
// 5  Any barriers to engaging with Taiwanese culture

// # Free form question to understand any desires from parents
// 6. What about culture would you hope is imparted onto your kids?
export type HouseholdCulture = Partial<{
  camperMessage: string
  languageFrequency: string
  cultureConfidence: string
  cultureLearn: string
  cultureBarrier: string
  cultureLesson: string
}>
