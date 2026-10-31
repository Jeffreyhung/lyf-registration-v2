import React, { createContext } from "react"

import {
  Camper,
  Family,
  Parent,
  RegistrationData as Registration2024Data,
  RegistrationStatus,
} from "lyf-registration-schemas"
import { DocumentIdWithType, FamilyData } from "@hooks/useFamilyData"

export type RegistrationData = Registration2024Data

export enum RegistrationActionType {
  AddParent = 1,
  AddCamper = 2,
  EditFamily = 3,
  EditParent = 4,
  EditCamper = 5,
  EditDemographics = 6,
  LoadFromCache = 7,
  SetNumOfCampers = 8,
  RemoveParent = 9,
  RemoveCamper = 10,
  SetDonation = 11,
  ClearData = 12,
  PrefillCamper = 13,
  PrefillParent = 14,
  PrefillFamily = 15,
  LoadPendingPaymentRegistrations = 16,
  EditHousehold = 17,
  SetJoinFamily = 18,
}

export interface RegistrationBaseAction {
  type: RegistrationActionType
}

export interface RegistrationEditAction extends RegistrationBaseAction {
  index: number
  keyToChange: string
  newValue: any
}

export interface RegistrationEditFamilyAction extends RegistrationBaseAction {
  keyToChange: string
  newValue: any
}

export interface RegistrationEditHouseholdAction extends RegistrationBaseAction {
  keyToChange: string
  newValue: any
}

export type RegistrationAddAction = RegistrationBaseAction

export interface RegistrationRemoveAction extends RegistrationBaseAction {
  index: number
}

export interface RegistrationSetNumOfCampersAction
  extends RegistrationBaseAction {
  numOfCampers: number
}

export interface RegistrationSetDonationAction extends RegistrationBaseAction {
  donation: number
}

export interface RegistrationPrefillCamperAction
  extends RegistrationBaseAction {
  index: number
  camper: DocumentIdWithType<Camper>
}

export interface RegistrationPrefillParentAction
  extends RegistrationBaseAction {
  index: number
  parent: DocumentIdWithType<Parent>
}

export interface RegistrationPrefillFamilyAction
  extends RegistrationBaseAction {
  family: DocumentIdWithType<Family>
}

export interface RegistrationLoadPendingPaymentRegistrationsAction
  extends RegistrationBaseAction {
  campYear: number
  familyData: FamilyData
}

// Records the parent's answer to "is this existing family yours?": the
// family's id, or null to register into a family of their own.
export interface RegistrationSetJoinFamilyAction
  extends RegistrationBaseAction {
  joinFamilyId: string | null
}

export type RegistrationAction =
  | RegistrationAddAction
  | RegistrationEditAction
  | RegistrationRemoveAction
  | RegistrationSetNumOfCampersAction
  | RegistrationSetDonationAction
  | RegistrationPrefillCamperAction
  | RegistrationPrefillParentAction
  | RegistrationPrefillFamilyAction
  | RegistrationLoadPendingPaymentRegistrationsAction
  | RegistrationSetJoinFamilyAction

// The in-progress registration is mirrored to localStorage on every reducer
// action, and the step the family reached is stored next to it, so a later
// visit can offer to pick up where they left off.
export const REGISTRATION_STORAGE_KEY = "registration"
export const REGISTRATION_STEP_STORAGE_KEY = "registrationStep"

export type SavedRegistrationSession = {
  data: RegistrationData
  /** CheckoutFlow step index the family was on when the data was last saved. */
  step: number
}

export function saveRegistrationStep(step: number) {
  window.localStorage.setItem(REGISTRATION_STEP_STORAGE_KEY, step.toString())
}

export function clearSavedRegistration() {
  window.localStorage.removeItem(REGISTRATION_STORAGE_KEY)
  window.localStorage.removeItem(REGISTRATION_STEP_STORAGE_KEY)
}

/**
 * The session an earlier visit left behind, or null when there is nothing
 * worth offering to restore: no saved data, data that cannot be parsed, or a
 * visit that never got past the Info step. The last case matters because the
 * automatic prefill from the server already writes the cache, so without it
 * every return visit would be asked about a "previous session" that holds
 * nothing the family typed.
 */
export function readSavedRegistrationSession(): SavedRegistrationSession | null {
  const stored = window.localStorage.getItem(REGISTRATION_STORAGE_KEY)
  if (!stored) {
    return null
  }
  let data: RegistrationData
  try {
    data = JSON.parse(stored)
  } catch {
    return null
  }
  if (!data || !Array.isArray(data.campers)) {
    return null
  }
  const step = parseInt(
    window.localStorage.getItem(REGISTRATION_STEP_STORAGE_KEY) ?? "0"
  )
  if (!Number.isInteger(step) || step <= 0) {
    return null
  }
  return { data, step }
}

/**
 * Reducer that handles all of the state management for registrationState. Note that we have to always return a new copy of the registrationState
 * since React state is immutable.
 * @param registrationState
 * @param action
 * @returns A copy of the new registrationState.
 */
export function registrationReducer(
  registrationState: RegistrationData,
  action: RegistrationAction
): RegistrationData {
  let changedState = registrationState
  switch (action.type) {
    case RegistrationActionType.AddParent:
      changedState = {
        ...registrationState,
        parents: [...registrationState.parents, {}],
      }
      break
    case RegistrationActionType.AddCamper:
      changedState = {
        ...registrationState,
        campers: [...registrationState.campers, {}],
        demographics: [...registrationState.demographics, {}],
      }
      break
    case RegistrationActionType.EditFamily: {
      const { keyToChange, newValue } = action as RegistrationEditFamilyAction
      const updatedFamily = {
        ...registrationState.family,
        [keyToChange]: newValue,
      }
      changedState = {
        ...registrationState,
        family: updatedFamily,
      }
      break
    }
    
    case RegistrationActionType.EditHousehold: {
      const { keyToChange, newValue } = action as RegistrationEditHouseholdAction
      const updatedHousehold = {
        ...registrationState.household,
        [keyToChange]: newValue
      }
      changedState = {
        ...registrationState,
        household: updatedHousehold
      }
      break
    }

    case RegistrationActionType.EditParent: {
      const { index, keyToChange, newValue } = action as RegistrationEditAction
      const originalParent = registrationState.parents[index]
      const updatedParent = { ...originalParent, [keyToChange]: newValue }
      const updatedParents = [...registrationState.parents]
      updatedParents[index] = updatedParent
      changedState = {
        ...registrationState,
        parents: updatedParents,
      }
      break
    }
    case RegistrationActionType.EditCamper: {
      const { index, keyToChange, newValue } = action as RegistrationEditAction
      const originalCamper = registrationState.campers[index]
      const updatedCamper = { ...originalCamper, [keyToChange]: newValue }
      const updatedCampers = [...registrationState.campers]
      updatedCampers[index] = updatedCamper
      changedState = {
        ...registrationState,
        campers: updatedCampers,
      }
      break
    }
    case RegistrationActionType.EditDemographics: {
      const { index, keyToChange, newValue } = action as RegistrationEditAction
      const originalDemographics = registrationState.demographics[index]
      const updatedDemographics = {
        ...originalDemographics,
        [keyToChange]: newValue,
      }
      const updatedDemographicsList = [...registrationState.demographics]
      updatedDemographicsList[index] = updatedDemographics
      changedState = {
        ...registrationState,
        demographics: updatedDemographicsList,
      }
      break
    }
    case RegistrationActionType.LoadFromCache: {
      const storedRegistrationState = window.localStorage.getItem(
        REGISTRATION_STORAGE_KEY
      )
      if (!storedRegistrationState) {
        break
      }

      try {
        changedState = JSON.parse(storedRegistrationState)
      } catch {
        changedState = registrationState
      }
      break
    }
    case RegistrationActionType.SetNumOfCampers: {
      const { numOfCampers } = action as RegistrationSetNumOfCampersAction
      const currentNumOfCampers = registrationState.campers.length
      const newCampers =
        currentNumOfCampers < numOfCampers
          ? [
              ...registrationState.campers,
              ...Array(numOfCampers - currentNumOfCampers).fill({}),
            ]
          : registrationState.campers.slice(0, numOfCampers)
      const newDemographics =
        currentNumOfCampers < numOfCampers
          ? [
              ...registrationState.demographics,
              ...Array(numOfCampers - currentNumOfCampers).fill({}),
            ]
          : registrationState.demographics.slice(0, numOfCampers)
      changedState = {
        ...registrationState,
        campers: newCampers,
        demographics: newDemographics,
      }
      break
    }
    case RegistrationActionType.RemoveParent: {
      const { index } = action as RegistrationRemoveAction
      changedState = {
        ...registrationState,
        parents: registrationState.parents.filter((_, i) => i !== index),
      }
      break
    }
    case RegistrationActionType.RemoveCamper: {
      const { index } = action as RegistrationRemoveAction
      changedState = {
        ...registrationState,
        campers: registrationState.campers.filter((_, i) => i !== index),
        demographics: registrationState.demographics.filter(
          (_, i) => i !== index
        ),
      }
      break
    }
    case RegistrationActionType.SetDonation: {
      const { donation } = action as RegistrationSetDonationAction
      changedState = {
        ...registrationState,
        donation,
      }
      break
    }
    case RegistrationActionType.ClearData: {
      changedState = createEmptyRegistrationData(registrationState.campYear)
      break
    }
    case RegistrationActionType.PrefillCamper: {
      const { index, camper } = action as RegistrationPrefillCamperAction
      // Remove the document reference so it doesn't reference itself.
      // Also remove the registrations since Firebase has trouble parsing these.
      const { ref, registrations, demographics, ...rest } = camper as typeof camper & { demographics?: Record<string, any> }

      // Update the camper
      const originalCamper = registrationState.campers[index]
      const updatedCamper = { ...originalCamper, ...rest }
      const updatedCampers = [...registrationState.campers]
      updatedCampers[index] = updatedCamper

      // Update the demographicss
      const originalDemographics = registrationState.demographics[index]
      const updatedDemographics = { ...originalDemographics, ...demographics }
      const updatedDemographicsList = [...registrationState.demographics]
      updatedDemographicsList[index] = updatedDemographics

      changedState = {
        ...registrationState,
        campers: updatedCampers,
        demographics: updatedDemographicsList,
      }
      break
    }
    case RegistrationActionType.PrefillParent: {
      const { index, parent } = action as RegistrationPrefillParentAction
      // Remove the document reference so it doesn't reference itself.
      const { ref, id, stripeCustomerId, ...rest } = parent

      const originalParent = registrationState.parents[index]
      const updatedParent = { ...originalParent, ...rest }
      const updatedParents = [...registrationState.parents]
      updatedParents[index] = updatedParent
      changedState = {
        ...registrationState,
        parents: updatedParents,
      }
      break
    }
    case RegistrationActionType.PrefillFamily: {
      const { family } = action as RegistrationPrefillFamilyAction
      // Remove the document reference so it doesn't reference itself.
      const { ref, ...rest } = family

      const originalFamily = registrationState.family
      const updatedFamily = { ...originalFamily, ...rest }
      changedState = {
        ...registrationState,
        family: updatedFamily,
      }
      break
    }
    case RegistrationActionType.LoadPendingPaymentRegistrations: {
      const { campYear, familyData } =
        action as RegistrationLoadPendingPaymentRegistrationsAction

      // Load everything that could've served as an input to the form.

      // Load everything from family except the emails and firebase type.
      const { ref, emails, ...familyInfo } = familyData.family

      const updatedParents: RegistrationData["parents"] = []
      // Load all the parents
      familyData.parents.forEach((parent) => {
        const { ref, ...parentWithoutFirebaseTypes } = parent
        updatedParents.push(parentWithoutFirebaseTypes)
      })

      const updatedCampers: RegistrationData["campers"] = []
      const updatedDemographics: RegistrationData["demographics"] = []

      // Find all of the registrations from the specified camp year and load the registration and camper information.
      familyData.registrations.forEach((reg, path) => {
        // Ignore registrations that aren't for this camp year.
        // Ignore registration that aren't Pending Payment (aka off the waitlist).
        if (
          !path.includes(campYear.toString()) ||
          reg.status !== RegistrationStatus.PENDING_PAYMENT
        ) {
          return
        }

        const {
          grade,
          campTrack,
          cabinPreference,
          shirtSize,
          isReturning,
          additionalNotes,
          waiverFullName,
          waiverSignDate,
          waiverSignature,
          status,
          camper,
        } = reg

        const matchingCamper = familyData.campers.find(
          (c) => c.id === camper.id
        )

        const {
          ref,
          registrations,
          demographics,
          ...camperWithoutFirebaseTypes
        } = matchingCamper as typeof matchingCamper & { demographics?: Record<string, any> }

        // Be sure not to accidentally push any firebase types into this object. That messes with the upload later on.
        updatedCampers.push({
          ...camperWithoutFirebaseTypes,

          grade: grade,
          campTrack: campTrack,
          cabinPreference: cabinPreference,
          shirtSize: shirtSize,
          isReturning: isReturning,
          additionalNotes: additionalNotes,
          waiverFullName: waiverFullName,
          waiverSignature: waiverSignature,
          waiverSignDate: waiverSignDate,

          // Status is used here to track state but it won't actually be respected when we update the registration in our database.
          status: status,
        })

        updatedDemographics.push({
          ...demographics,
        })
      })

      changedState = {
        ...registrationState,
        family: familyInfo,
        parents: updatedParents,
        campers: updatedCampers,
        demographics: updatedDemographics,
      }
      break
    }
    case RegistrationActionType.SetJoinFamily: {
      const { joinFamilyId } = action as RegistrationSetJoinFamilyAction
      changedState = {
        ...registrationState,
        joinFamilyId,
      }
      break
    }
    default: {
      throw Error("Unknown action: " + action.type)
    }
  }

  // Save the state to local storage.
  if (action.type !== RegistrationActionType.ClearData) {
    window.localStorage.setItem(
      REGISTRATION_STORAGE_KEY,
      JSON.stringify(changedState)
    )
  } else {
    clearSavedRegistration()
  }

  return changedState
}

export function createEmptyRegistrationData(
  campYear: number
): RegistrationData {
  return {
    campYear: campYear,
    family: {},
    parents: [{}],
    campers: [{}],
    demographics: [{}],
    household: {},
    donation: 0,
    joinFamilyId: null,
  }
}

export const RegistrationDataContext = createContext<RegistrationData>(null)
export const RegistrationDispatchContext =
  createContext<React.Dispatch<RegistrationAction>>(null)
