import { createContext, Dispatch } from "react"

import { Camper, Pairings, Group, GroupId } from "small-group-pairing"

import { RegistrationData } from "@hooks/useRegistrations"
import { RegistrationStatus } from "lyf-registration-schemas"

export type CamperMetadata = {
  grade: string
  gender: string
  cabinName: string
  birthDate: string
  status: RegistrationStatus
  experience: string
  parentRequests: string
}
export type PairingCamper = Camper<CamperMetadata>
export type PairingGroup = Group<CamperMetadata>

export type SmallGroupState = {
  pairings: Pairings<CamperMetadata>
  groups: Group<CamperMetadata>[]
  editStack: SmallGroupAction[]
  redoStack: SmallGroupAction[]
  errorMsg: string | null
}

export enum SmallGroupActionType {
  LoadFromRegistrations = 0,
  SetGroup = 3,
  AddGroup = 4,
  Undo = 5,
  Redo = 6,
  ClearEditStack = 7,
  RunPairingAlgorithm = 8,
}

export interface SmallGroupBaseAction {
  type: SmallGroupActionType
}

export interface SmallGroupLoadFromRegistrationsAction
  extends SmallGroupBaseAction {
  registrations: RegistrationData[]
}

export interface SmallGroupSetGroupAction extends SmallGroupBaseAction {
  camper: PairingCamper
  groupId: GroupId
  prevGroupId: GroupId
}

export interface SmallGroupAddGroupAction extends SmallGroupBaseAction {
  groupId: GroupId
  minSize?: number
  maxSize?: number
}

export type SmallGroupClearEditStackAction = SmallGroupBaseAction

export interface SmallGroupRunPairingAlgorithmAction
  extends SmallGroupBaseAction {
  prevPairings: Pairings<CamperMetadata>
}

export type SmallGroupAction =
  | SmallGroupBaseAction
  | SmallGroupLoadFromRegistrationsAction
  | SmallGroupSetGroupAction
  | SmallGroupAddGroupAction
  | SmallGroupClearEditStackAction
  | SmallGroupRunPairingAlgorithmAction

export function loadFromRegistrations(
  registrations: RegistrationData[]
): Pairings<CamperMetadata> {
  const validRegistrations = registrations.filter(
    (r) => r.smallGroup != null || r.status === RegistrationStatus.ACTIVE
  )

  const campers: PairingCamper[] = validRegistrations.map((c) => ({
    id: c.registrationRef.id,
    name: c.camperName,
    groupId: c.smallGroup || undefined,
    metadata: {
      grade: c.grade.toString(),
      gender: c.gender?.join(", "),
      cabinName: "",
      birthDate: c.birthDate,
      status: c.status,
      experience: "",
      parentRequests: "",
    },
  }))

  // Hard-coded groups for now
  const groups: PairingGroup[] = Array.from({ length: 18 }, (_, i) => ({
    id: String.fromCharCode("A".charCodeAt(0) + i),
    minSize: 0,
    maxSize: 20,
    members: new Set<Camper<CamperMetadata>>(),
  }))

  return new Pairings<CamperMetadata>(groups, campers)
}

/**
 * Reducer that handles all of the state management for the small group pairing.
 * Note that we always have to return a new object for rendering since React state is
 * supposed to be immutable.
 */
export function smallGroupReducer(
  smallGroupState: SmallGroupState,
  action: SmallGroupAction
): SmallGroupState {
  let { pairings, editStack, redoStack } = smallGroupState
  let errorMsg = null
  try {
    pairings = performAction(action, pairings)
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e)
  }

  // Following is just for undo/redo logic
  switch (action.type) {
    case SmallGroupActionType.LoadFromRegistrations: {
      editStack = []
      redoStack = []
      break
    }
    case SmallGroupActionType.Undo: {
      const actionToUndo = editStack.pop()
      if (actionToUndo === null) break

      pairings = undo(actionToUndo, pairings)
      editStack = [...editStack] // Action already removed
      redoStack = [...redoStack, actionToUndo]
      break
    }
    case SmallGroupActionType.Redo: {
      const actionToRedo = redoStack.pop()
      if (actionToRedo === null) break

      pairings = performAction(actionToRedo, pairings)
      editStack = [...editStack, actionToRedo] // Don't add the redo action
      redoStack = [...redoStack] // Action already removed
      break
    }
    case SmallGroupActionType.ClearEditStack: {
      editStack = []
      redoStack = []
      break
    }
    // All other actions, we want to add it to the edit stack and reset the redo stack
    default: {
      editStack = [...editStack, action]
      redoStack = []
      break
    }
  }

  return {
    pairings: pairings,
    groups: pairings.getGroupsCopy(),
    editStack: editStack,
    redoStack: redoStack,
    errorMsg: errorMsg,
  }
}

function performAction(
  action: SmallGroupAction,
  pairings: Pairings<CamperMetadata>
): Pairings<CamperMetadata> {
  switch (action.type) {
    case SmallGroupActionType.LoadFromRegistrations: {
      const { registrations } = action as SmallGroupLoadFromRegistrationsAction

      return loadFromRegistrations(registrations)
    }
    case SmallGroupActionType.SetGroup: {
      const { camper, groupId } = action as SmallGroupSetGroupAction
      pairings.assignCamperToGroupId(camper, groupId)
      return pairings
    }
    case SmallGroupActionType.AddGroup: {
      const {
        groupId,
        minSize = 0,
        maxSize = 20,
      } = action as SmallGroupAddGroupAction

      pairings.addGroup(groupId, minSize, maxSize)
      return pairings
    }
    case SmallGroupActionType.Undo: {
      return pairings
    }
    case SmallGroupActionType.Redo: {
      return pairings
    }
    case SmallGroupActionType.ClearEditStack: {
      return pairings
    }
    case SmallGroupActionType.RunPairingAlgorithm: {
      // TODO(kevinlai): Add the actual pairing algorithm run here.
      const newPairings = pairings.copy()
      newPairings.addGroup("Z")

      return newPairings
    }
  }
}

function undo(
  action: SmallGroupAction,
  pairings: Pairings<CamperMetadata>
): Pairings<CamperMetadata> {
  switch (action.type) {
    case SmallGroupActionType.SetGroup: {
      const { camper, prevGroupId } = action as SmallGroupSetGroupAction
      pairings.assignCamperToGroupId(camper, prevGroupId)
      break
    }
    case SmallGroupActionType.AddGroup: {
      const { groupId } = action as SmallGroupAddGroupAction
      pairings.removeGroup(groupId)
      break
    }
    case SmallGroupActionType.RunPairingAlgorithm: {
      const { prevPairings } = action as SmallGroupRunPairingAlgorithmAction
      pairings = prevPairings
      break
    }
    default:
      console.error("Unsupported undo action: ", action)
  }

  return pairings
}

export const SmallGroupContext = createContext<SmallGroupState>(null)
export const SmallGroupDispatchContext =
  createContext<Dispatch<SmallGroupAction>>(null)
