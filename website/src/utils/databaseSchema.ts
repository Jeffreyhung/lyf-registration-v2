import { DocumentReference, Timestamp } from "firebase/firestore"

// Every type exported in this file is Partial because Firebase makes
// no guarantees that every field is present. Since Firebase allows anything to
// be stored on an object without defining a schema, this is only one potential
// subset of what could be stored for each type.

// Feel free to add additional values in the future!

type DocumentId = {
  ref: DocumentReference,
  id: string
}

export type Family = DocumentId &
  Partial<{
    city: string
    state: string
    suite: string
    zip: string
    emails: string[]
  }>

export type Parent = DocumentId &
  Partial<{
    email: string
    firstName: string
    lastName: string
    lineId: string
    phoneNumber: string
    subscribeToMailingList: boolean
  }>

export type Camper = DocumentId &
  Partial<{
    firstName: string
    lastName: string
    birthDate: string

    email: string
    gender: string[]
    // Health fields (dietAndFoodAllergies, medicalConditions) are NOT on the
    // camper doc since schemaVersion 2 — they live at
    // campers/{id}/private/health. See CamperHealth in lyf-registration-schemas.
    registrations: DocumentReference<Registration>[]
    returning: boolean
  }>

export type Registration = DocumentId &
  Partial<{
    camper: DocumentReference<Camper>
    camperName: string
    createdAt: Timestamp
    updatedAt: Timestamp

    grade: number
    shirtSize: string
    status: string

    demographics: Record<string, unknown>

    isPreRegistered: boolean


    isCheckedOut: boolean
    checkedOutTime: Timestamp
    nameOfParentCheckedOut: string

    additionalNotes: string

    internalNotes: string
  }>

export type CampCredit = DocumentId

export type Payment = DocumentId & Partial<{
  createdAt: Timestamp,
  updatedAt: Timestamp,

  customerEmail: string,
  customerId: string, // customer Stripe ID
  customerName: string,
  donation: number,
  items: {
    amount: number,
    description: string
  }[],
  paymentMethod: string,
  status: string,
  stripeId: string,
  total: number,
  balance: number,
  type: string, // Stripe, Zelle, etc 
}>
