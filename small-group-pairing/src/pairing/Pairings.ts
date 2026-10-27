/**
 * Top level class which holds all the internal state of the small group pairing.
 *
 * We'll use a Loader and MetadataProvider prior to calling this class to get the Groups and Campers.
 */

import {Camper, CamperId, Group, GroupId} from "../types"
import {UNASSIGNED_GROUP_ID} from "../utils"

/** Treats a missing or empty group id as the unassigned group. */
function normalizeGroupId(groupId: GroupId | undefined): GroupId {
  return groupId || UNASSIGNED_GROUP_ID
}

export class Pairings<T> {
  public groups: Group<T>[]
  public campers: Camper<T>[]

  private groupMapping: Map<GroupId, Group<T>>

  constructor(groups: Group<T>[], campers: Camper<T>[]) {
    const ungrouped: Group<T> = {
      id: UNASSIGNED_GROUP_ID,
      minSize: 0,
      maxSize: campers.length,
      members: new Set<Camper<T>>(),
    }
    this.groups = [ungrouped, ...groups]
    this.campers = campers

    // Create a map of groupId to group for easier finding
    this.groupMapping = new Map(this.groups.map((group) => [group.id, group]))

    // For each camper, use the initially provided groupId to assign them to a group.
    // Campers may reference a group that wasn't passed in (e.g. a legacy group id
    // persisted in the database), so auto-create any missing group rather than crash.
    this.campers.forEach((camper) => {
      const groupId = normalizeGroupId(camper.groupId)
      this.addGroup(groupId)
      this.assignCamperToGroupId(camper, groupId)
    })
  }

  addGroup(groupId: GroupId, minSize = 0, maxSize = 20) {
    if (this.groupMapping.has(groupId)) {
      return
    }

    const group: Group<T> = {
      id: groupId,
      minSize,
      maxSize,
      members: new Set<Camper<T>>(),
    }
    this.groupMapping.set(groupId, group)
    this.groups.push(group)
  }

  addCamper(camper: Camper<T>) {
    this.campers.push(camper)
    const groupId = normalizeGroupId(camper.groupId)
    // This will no-op if the group already exists.
    this.addGroup(groupId)
    this.assignCamperToGroupId(camper, groupId)
  }

  // TODO: Add a check to make sure group is not full and decide what to do in that case.
  assignCamperToGroup(camper: Camper<T>, group: Group<T>) {
    // Remove the camper from the original group.
    this.groupMapping.get(camper.groupId)?.members.delete(camper)

    // Assign the camper to the new grop.
    camper.groupId = group.id
    group.members.add(camper)
  }

  // TODO: Add a check to make sure group is not full and decide what to do in that case.
  assignCamperToGroupId(camper: Camper<T>, groupId: GroupId) {
    const group = this.groupMapping.get(groupId)
    if (!group) {
      throw new Error(`Cannot assign camper ${camper.id} to unknown group "${groupId}"`)
    }
    this.assignCamperToGroup(camper, group)
  }

  removeCamper(camperId: CamperId) {
    const camper = this.campers.find((camper) => camper.id === camperId)
    if (!camper) {
      return
    }

    // Remove the camper from the original group.
    this.groupMapping.get(camper.groupId)?.members.delete(camper)

    // Remove the camper from the list of campers.
    this.campers = this.campers.filter((camper) => camper.id !== camperId)
  }

  removeGroup(groupId: GroupId) {
    // Assign any campers in the group to the unassigned group.
    const group = this.groupMapping.get(groupId)
    if (!group) {
      return
    }

    group.members.forEach((camper) => {
      this.assignCamperToGroupId(camper, UNASSIGNED_GROUP_ID)
    })

    // Remove the group from the list of groups.
    this.groups = this.groups.filter((group) => group.id !== groupId)

    // Remove the group from the mapping.
    this.groupMapping.delete(groupId)
  }

  /**
   * @param groupId The id of the group to get.
   * @returns The group with the given id.
   */
  getGroup(groupId: GroupId): Group<T> {
    return this.groupMapping.get(groupId)
  }

  /**
   * Creates new Camper and Group objects and returns all new arrays to be used by the new Pairings object.
   * @returns A deep copy of the Pairings
   */
  copy(): Pairings<T> {
    // The first group is always the unassigned group, so we'll just ignore that one.
    const newGroups = this.groups.slice(1).map((group) => ({
      ...group,
      members: new Set<Camper<T>>(),
    }))
    const newCampers = this.campers.map((camper) => ({...camper}))
    return new Pairings(newGroups, newCampers)
  }

  getGroupsCopy(): Group<T>[] {
    return this.groups.map((group) => ({
      ...group,
    }))
  }
}
