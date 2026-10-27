import {Pairings} from "@/pairing/Pairings"
import {Camper, Group} from "@/types"
import {UNASSIGNED_GROUP_ID} from "@/utils"

function camper(id: string, groupId?: string): Camper<undefined> {
  return {id, name: `Camper ${id}`, groupId}
}

function group(id: string, maxSize = 10): Group<undefined> {
  return {id, members: new Set(), minSize: 0, maxSize}
}

function memberIds<T>(pairings: Pairings<T>, groupId: string): string[] {
  return [...pairings.getGroup(groupId).members].map((c) => c.id).sort()
}

test("Single camper into unassigned group", () => {
  const campers: Camper<any>[] = [
    {
      id: "1",
      name: "Camper 1",
    },
  ]

  const groups: Group<any>[] = []

  const pairings = new Pairings(groups, campers)

  expect(pairings.groups).toHaveLength(1)
  expect(pairings.groups[0].id).toBe(UNASSIGNED_GROUP_ID)
  expect(pairings.groups[0].members.size).toBe(1)
})

test("Assign single camper to group", () => {
  const camper1: Camper<any> = {
    id: "1",
    name: "Camper 1",
  }
  const campers: Camper<any>[] = [camper1]

  const groupA: Group<any> = {
    id: "A",
    members: new Set(),
    minSize: 0,
    maxSize: 10,
  }
  const groups: Group<any>[] = [groupA]

  const pairings = new Pairings(groups, campers)

  expect(pairings.groups).toHaveLength(2)

  // First assignment is to the unassigned group
  const unassignedGroup = pairings.getGroup(UNASSIGNED_GROUP_ID)
  expect(unassignedGroup.members.has(camper1)).toBe(true)

  // Assign camper to group
  pairings.assignCamperToGroup(campers[0], groups[0])
  expect(groupA.members.has(camper1)).toBe(true)
  expect(unassignedGroup.members.has(camper1)).toBe(false)
})

describe("constructor", () => {
  test("places campers into the groups they already belong to", () => {
    const pairings = new Pairings(
      [group("A"), group("B")],
      [camper("1", "A"), camper("2", "B"), camper("3", "A"), camper("4")]
    )

    expect(memberIds(pairings, "A")).toEqual(["1", "3"])
    expect(memberIds(pairings, "B")).toEqual(["2"])
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["4"])
  })

  test("keeps the unassigned group first and sizes it to hold everyone", () => {
    const pairings = new Pairings([group("A")], [camper("1"), camper("2")])

    const [unassigned] = pairings.groups
    expect(unassigned.id).toBe(UNASSIGNED_GROUP_ID)
    expect(unassigned.minSize).toBe(0)
    expect(unassigned.maxSize).toBe(2)
  })

  test("stamps the unassigned group id onto campers without one", () => {
    const c = camper("1")
    new Pairings([], [c])

    expect(c.groupId).toBe(UNASSIGNED_GROUP_ID)
  })

  test("auto-creates groups referenced by campers that were not passed in", () => {
    // Regression: a camper whose persisted groupId is not one of the provided
    // groups used to crash with "Cannot read properties of undefined (reading 'members')".
    const pairings = new Pairings(
      [group("A")],
      [camper("1", "A"), camper("2", "legacy"), camper("3", "legacy")]
    )

    expect(pairings.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "A", "legacy"])
    expect(pairings.getGroup("legacy")).toMatchObject({minSize: 0, maxSize: 20})
    expect(memberIds(pairings, "A")).toEqual(["1"])
    expect(memberIds(pairings, "legacy")).toEqual(["2", "3"])
  })

  test("treats an empty-string groupId as unassigned", () => {
    const c = camper("1", "")
    const pairings = new Pairings([group("A")], [c])

    expect(c.groupId).toBe(UNASSIGNED_GROUP_ID)
    expect(pairings.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "A"])
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["1"])
  })
})

describe("getGroup", () => {
  test("finds groups by id and returns undefined for unknown ids", () => {
    const a = group("A")
    const pairings = new Pairings([a], [])

    expect(pairings.getGroup("A")).toBe(a)
    expect(pairings.getGroup(UNASSIGNED_GROUP_ID)).toBe(pairings.groups[0])
    expect(pairings.getGroup("nope")).toBeUndefined()
  })
})

describe("addGroup", () => {
  test("adds an empty group with the given sizes", () => {
    const pairings = new Pairings([], [])

    pairings.addGroup("A", 2, 6)

    const added = pairings.getGroup("A")
    expect(added).toEqual({id: "A", minSize: 2, maxSize: 6, members: new Set()})
    expect(pairings.groups).toHaveLength(2)
    expect(pairings.groups[1]).toBe(added)
  })

  test("defaults to a 0-20 size range", () => {
    const pairings = new Pairings([], [])

    pairings.addGroup("A")

    expect(pairings.getGroup("A")).toMatchObject({minSize: 0, maxSize: 20})
  })

  test("is a no-op for an existing group, keeping its members", () => {
    const pairings = new Pairings([group("A")], [camper("1", "A")])

    pairings.addGroup("A", 5, 5)

    expect(pairings.groups).toHaveLength(2)
    expect(pairings.getGroup("A")).toMatchObject({minSize: 0, maxSize: 10})
    expect(memberIds(pairings, "A")).toEqual(["1"])
  })
})

describe("addCamper", () => {
  test("adds an unassigned camper to the unassigned group", () => {
    const pairings = new Pairings([group("A")], [])

    pairings.addCamper(camper("1"))

    expect(pairings.campers.map((c) => c.id)).toEqual(["1"])
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["1"])
  })

  test("adds a camper straight into their existing group", () => {
    const pairings = new Pairings([group("A")], [])

    pairings.addCamper(camper("1", "A"))

    expect(memberIds(pairings, "A")).toEqual(["1"])
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual([])
  })

  test("creates the camper's group when it does not exist yet", () => {
    const pairings = new Pairings([], [])

    pairings.addCamper(camper("1", "new"))

    expect(pairings.getGroup("new")).toBeDefined()
    expect(memberIds(pairings, "new")).toEqual(["1"])
    expect(pairings.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "new"])
  })
})

describe("assignCamperToGroup / assignCamperToGroupId", () => {
  test("moves a camper between groups and updates their groupId", () => {
    const c = camper("1", "A")
    const pairings = new Pairings([group("A"), group("B")], [c])

    pairings.assignCamperToGroup(c, pairings.getGroup("B"))
    expect(c.groupId).toBe("B")
    expect(memberIds(pairings, "A")).toEqual([])
    expect(memberIds(pairings, "B")).toEqual(["1"])

    pairings.assignCamperToGroupId(c, UNASSIGNED_GROUP_ID)
    expect(c.groupId).toBe(UNASSIGNED_GROUP_ID)
    expect(memberIds(pairings, "B")).toEqual([])
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["1"])
  })

  test("re-assigning to the same group leaves the camper in it", () => {
    const c = camper("1", "A")
    const pairings = new Pairings([group("A")], [c])

    pairings.assignCamperToGroupId(c, "A")

    expect(memberIds(pairings, "A")).toEqual(["1"])
  })

  test("throws a descriptive error for an unknown group id and leaves the camper put", () => {
    const c = camper("1", "A")
    const pairings = new Pairings([group("A")], [c])

    expect(() => pairings.assignCamperToGroupId(c, "nope")).toThrow(
      'Cannot assign camper 1 to unknown group "nope"'
    )
    expect(c.groupId).toBe("A")
    expect(memberIds(pairings, "A")).toEqual(["1"])
  })
})

describe("addCamper with an empty groupId", () => {
  test("places the camper in the unassigned group", () => {
    const pairings = new Pairings([group("A")], [])

    pairings.addCamper(camper("1", ""))

    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["1"])
    expect(pairings.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "A"])
  })
})

describe("removeCamper", () => {
  test("removes the camper from their group and the camper list", () => {
    const pairings = new Pairings([group("A")], [camper("1", "A"), camper("2", "A")])

    pairings.removeCamper("1")

    expect(pairings.campers.map((c) => c.id)).toEqual(["2"])
    expect(memberIds(pairings, "A")).toEqual(["2"])
  })

  test("ignores an unknown camper id", () => {
    const pairings = new Pairings([group("A")], [camper("1", "A")])

    pairings.removeCamper("nope")

    expect(pairings.campers).toHaveLength(1)
    expect(memberIds(pairings, "A")).toEqual(["1"])
  })
})

describe("removeGroup", () => {
  test("moves the group's campers back to unassigned and drops the group", () => {
    const pairings = new Pairings(
      [group("A"), group("B")],
      [camper("1", "A"), camper("2", "A"), camper("3", "B")]
    )

    pairings.removeGroup("A")

    expect(pairings.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "B"])
    expect(pairings.getGroup("A")).toBeUndefined()
    expect(memberIds(pairings, UNASSIGNED_GROUP_ID)).toEqual(["1", "2"])
    expect(memberIds(pairings, "B")).toEqual(["3"])
    expect(pairings.campers.find((c) => c.id === "1")?.groupId).toBe(
      UNASSIGNED_GROUP_ID
    )
  })

  test("ignores an unknown group id", () => {
    const pairings = new Pairings([group("A")], [camper("1", "A")])

    pairings.removeGroup("nope")

    expect(pairings.groups).toHaveLength(2)
    expect(memberIds(pairings, "A")).toEqual(["1"])
  })
})

describe("copy", () => {
  test("preserves groups, sizes and assignments", () => {
    const original = new Pairings(
      [group("A", 4), group("B", 6)],
      [camper("1", "A"), camper("2", "B"), camper("3")]
    )

    const copy = original.copy()

    expect(copy.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "A", "B"])
    expect(copy.getGroup("A")).toMatchObject({minSize: 0, maxSize: 4})
    expect(copy.getGroup("B")).toMatchObject({minSize: 0, maxSize: 6})
    expect(memberIds(copy, "A")).toEqual(["1"])
    expect(memberIds(copy, "B")).toEqual(["2"])
    expect(memberIds(copy, UNASSIGNED_GROUP_ID)).toEqual(["3"])
  })

  test("is deep: changing the copy leaves the original alone", () => {
    const original = new Pairings([group("A"), group("B")], [camper("1", "A")])

    const copy = original.copy()
    const copied = copy.campers[0]
    expect(copied).not.toBe(original.campers[0])

    copy.assignCamperToGroupId(copied, "B")
    copy.addCamper(camper("2", "A"))
    copy.removeGroup("A")

    expect(original.campers.map((c) => c.id)).toEqual(["1"])
    expect(original.campers[0].groupId).toBe("A")
    expect(memberIds(original, "A")).toEqual(["1"])
    expect(memberIds(original, "B")).toEqual([])
    expect(original.groups.map((g) => g.id)).toEqual([UNASSIGNED_GROUP_ID, "A", "B"])
  })
})

describe("getGroupsCopy", () => {
  test("returns new group objects that still share their member sets", () => {
    const pairings = new Pairings([group("A")], [camper("1", "A")])

    const groups = pairings.getGroupsCopy()

    expect(groups).toHaveLength(2)
    expect(groups[1]).not.toBe(pairings.groups[1])
    expect(groups[1]).toEqual(pairings.groups[1])
    // Shallow copy by design: mutating a copied group's fields does not leak back.
    groups[1].maxSize = 99
    expect(pairings.getGroup("A").maxSize).toBe(10)
  })
})
