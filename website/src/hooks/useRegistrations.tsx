import * as React from "react"
import {
  collection,
  doc,
  DocumentData,
  Firestore,
  query,
  QueryConstraint,
  DocumentReference,
  QueryDocumentSnapshot,
  getDoc,
  getDocs,
} from "firebase/firestore"
import { useCollection } from "react-firebase-hooks/firestore"

import {
  AdminRole,
  roleHasCapability,
  Camper,
  CamperHealth,
  Demographics,
  Family,
  Parent,
  ParentContact,
  Registration,
} from "lyf-registration-schemas"

type useRegistrationsProps = {
  isAdmin: boolean
  adminRole: AdminRole | null
  /** `null` while the camp year is still being resolved: nothing is queried and the hook reports loading. */
  campYear: number | null
  constraints?: QueryConstraint[]
  firestore: Firestore
}

type FamilyData = {
  parents: Parent[]
  familyId: string
  // The family document (address, household culture, account emails) behind
  // the dashboard's family columns and the exports. Loaded in the second
  // pass, one read per family, so it arrives after first paint.
  familyData?: Family
}

export type RegistrationData = Registration &
  Partial<Camper> &
  Partial<CamperHealth> &
  FamilyData & {
    registrationRef: DocumentReference
    registrationYear: number
    demographics?: Demographics
  }

// Role-gated sub-documents of a camper, cached per camper path so a status
// flip on the registration (Stripe webhook, admin edit) never refetches them.
type PrivateData = {
  health?: CamperHealth
  demographics?: Demographics
}

// How many private/{health,demographics} fetches are in flight at once during
// the second pass. Firestore's client multiplexes these over one channel; the
// cap keeps a 170-row year from issuing hundreds of reads in a single tick.
const PRIVATE_READ_CONCURRENCY = 10

const parentIndex = (parent: Parent, emails: string[]) => {
  if (!parent.email) {
    return Number.MAX_SAFE_INTEGER
  }

  const index = emails.indexOf(parent.email)
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

const canReadHealth = (role: AdminRole | null) =>
  roleHasCapability(role, "readHealth")

const canReadDemographics = (role: AdminRole | null) =>
  roleHasCapability(role, "readDemographics")

/**
 * A registration written at schemaVersion 3 or later carries the camper
 * profile and parent contacts itself, so the grid needs no extra reads for it.
 * `parentContacts` is the marker: the registration function writes it on every
 * create/update and the backfill script adds it to older documents.
 */
const isDenormalized = (data: Registration) =>
  Array.isArray(data.parentContacts)

const parentContactToParent = (contact: ParentContact): Parent => ({
  firstName: contact.firstName,
  lastName: contact.lastName,
  email: contact.email,
  phoneNumber: contact.phoneNumber,
})

const mergePrivate = (
  row: RegistrationData,
  priv: PrivateData | undefined
): RegistrationData => {
  if (!priv) {
    return row
  }
  return {
    ...row,
    ...(priv.health ?? {}),
    ...(priv.demographics ? { demographics: priv.demographics } : {}),
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
}

export default function useRegistrations({
  isAdmin,
  adminRole,
  campYear,
  constraints = [],
  firestore,
}: useRegistrationsProps): [RegistrationData[], boolean, Error | undefined] {
  const [allData, setAllData] = React.useState<RegistrationData[]>([])
  // Errors from the per-registration reads (legacy camper/family fan-out,
  // private sub-documents). They are surfaced through the hook's error slot
  // instead of escaping as unhandled promise rejections (which is how they
  // used to reach Sentry with no stack trace: "FirebaseError: Missing or
  // insufficient permissions").
  const [loadError, setLoadError] = React.useState<Error | undefined>()

  // so that we don't create a new map on every render: https://beta.reactjs.org/reference/react/useRef#avoiding-recreating-the-ref-contents
  const regDataMap = React.useRef<Map<string, RegistrationData>>(undefined)
  // Legacy (pre-schemaVersion 3) caches: camper doc by camper id, family +
  // parents by family id.
  const camperDataMap = React.useRef<Map<string, Partial<Camper>>>(undefined)
  const familyDataMap = React.useRef<Map<string, FamilyData>>(undefined)
  // Resolved private sub-documents by camper path, plus the paths whose
  // reads are still in flight so two snapshots arriving close together
  // (e.g. a webhook status flip right after page load) issue one fetch.
  const privateDataMap = React.useRef<Map<string, PrivateData>>(undefined)
  const privateInFlight = React.useRef<Set<string>>(undefined)
  // Family documents by family id (address / household for the grid columns),
  // plus the ids whose reads are still in flight.
  const familyDocMap = React.useRef<Map<string, Family>>(undefined)
  const familyInFlight = React.useRef<Set<string>>(undefined)
  // Bumped whenever the caches are reset. Async continuations compare the
  // generation they started under with the current one and drop their results
  // if the role, year or Firestore instance changed underneath them.
  const generation = React.useRef(0)

  const resetCaches = () => {
    regDataMap.current = new Map()
    camperDataMap.current = new Map()
    familyDataMap.current = new Map()
    privateDataMap.current = new Map()
    privateInFlight.current = new Set()
    familyDocMap.current = new Map()
    familyInFlight.current = new Set()
    generation.current += 1
  }

  const pastFirestore = React.useRef<Firestore>(firestore)
  if (regDataMap.current === undefined || pastFirestore.current !== firestore) {
    pastFirestore.current = firestore
    resetCaches()
  }

  const [values, loading, error] = useCollection<Registration>(
    isAdmin && adminRole && campYear !== null
      ? query<Registration, DocumentData>(
          collection(firestore, `camps/${campYear}/registrations`),
          ...constraints
        )
      : null
  )

  // Clear caches when role or campYear changes. (Firestore instance changes
  // are handled during render above.) This effect is declared before the
  // hydration effect so, within one commit, the reset runs first.
  const prevAdminRole = React.useRef(adminRole)
  const prevCampYear = React.useRef(campYear)
  React.useEffect(() => {
    if (
      prevAdminRole.current !== adminRole ||
      prevCampYear.current !== campYear
    ) {
      resetCaches()
      setAllData([])
      setLoadError(undefined)
      prevAdminRole.current = adminRole
      prevCampYear.current = campYear
    }
  }, [adminRole, campYear])

  React.useEffect(() => {
    const gen = generation.current
    const isCurrent = () => gen === generation.current

    const publish = () => {
      if (!isCurrent()) {
        return
      }
      setAllData(
        Array.from(regDataMap.current.values()).filter(
          (reg) => reg.registrationYear === campYear
        )
      )
    }

    let firstError: Error | undefined
    const recordError = (context: string, err: unknown) => {
      firstError ??= err instanceof Error ? err : new Error(String(err))
      console.error(`[useRegistrations] ${context}`, err)
    }

    // Base row for a schemaVersion >= 3 registration: everything the grid
    // needs is on the document itself. Zero reads.
    const buildDenormalizedRow = (
      registration: QueryDocumentSnapshot<Registration>
    ): RegistrationData => {
      const data = registration.data()
      const familyRef = data.camper?.parent?.parent as
        | DocumentReference<Family>
        | undefined
      return {
        registrationRef: registration.ref,
        registrationYear: campYear,
        ...data,
        parents: (data.parentContacts ?? []).map(parentContactToParent),
        familyId: familyRef?.id ?? "",
        familyData: familyRef
          ? familyDocMap.current.get(familyRef.id)
          : undefined,
      }
    }

    // Base row for a legacy registration: camper doc + family doc + parents
    // subcollection, each cached so a family with several campers (or a
    // later snapshot) reads them once.
    const buildLegacyRow = async (
      registration: QueryDocumentSnapshot<Registration>
    ): Promise<RegistrationData> => {
      const data = registration.data()

      let camperData = camperDataMap.current.get(data.camper.id)
      if (!camperData) {
        const camper = await getDoc<Camper, DocumentData>(data.camper)
        camperData = camper.exists() ? camper.data() : {}
        if (!camper.exists()) {
          console.error("No camper found.")
        }
        if (isCurrent()) {
          camperDataMap.current.set(data.camper.id, camperData)
        }
      }

      const family = data.camper.parent.parent as DocumentReference<Family>
      const familyId = family.id as string
      let familyData = familyDataMap.current.get(familyId)
      if (!familyData) {
        const fam = await getDoc<Family, DocumentData>(family)
        const emails = fam.data()?.emails

        const parents = await getDocs<Parent, DocumentData>(
          query(collection(firestore, `/families/${familyId}/parents`))
        )
        let parentsData = parents.docs.map((p) => p.data())

        if (emails) {
          parentsData = parentsData.sort(
            (a, b) => parentIndex(a, emails) - parentIndex(b, emails)
          )
        }

        const familyDoc = fam.exists() ? (fam.data() as Family) : undefined
        familyData = { parents: parentsData, familyId, familyData: familyDoc }
        if (isCurrent()) {
          familyDataMap.current.set(familyId, familyData)
          if (familyDoc) {
            familyDocMap.current.set(familyId, familyDoc)
          }
        }
      }

      return {
        registrationRef: registration.ref,
        registrationYear: campYear,
        ...camperData,
        ...data,
        ...familyData,
      }
    }

    // Second pass: role-gated private sub-documents. Resolves into the cache
    // and then merges into whichever rows currently point at that camper, so
    // a registration re-hydrated while the read was in flight still gets it.
    // Claims the paths (marks them in flight) synchronously so a concurrent
    // run of this effect skips them.
    const claimCamperPathsNeedingPrivate = (
      regs: QueryDocumentSnapshot<Registration>[]
    ): string[] => {
      const wantHealth = canReadHealth(adminRole)
      const wantDemographics = canReadDemographics(adminRole)
      if (!wantHealth && !wantDemographics) {
        return []
      }
      const paths = new Set<string>()
      regs.forEach((reg) => {
        const path = reg.data().camper?.path
        if (
          path &&
          !privateDataMap.current.has(path) &&
          !privateInFlight.current.has(path)
        ) {
          paths.add(path)
          privateInFlight.current.add(path)
        }
      })
      return Array.from(paths)
    }

    const fetchPrivate = async (camperPath: string): Promise<PrivateData> => {
      const priv: PrivateData = {}
      const [healthDoc, demoDoc] = await Promise.all([
        canReadHealth(adminRole)
          ? getDoc(doc(firestore, `${camperPath}/private/health`)).catch(
              (): undefined => undefined
            )
          : Promise.resolve(undefined),
        canReadDemographics(adminRole)
          ? getDoc(doc(firestore, `${camperPath}/private/demographics`)).catch(
              (): undefined => undefined
            )
          : Promise.resolve(undefined),
      ])
      // A failed or missing read leaves the section empty; the row still
      // renders with the Tier-0 data it already has.
      if (healthDoc?.exists()) {
        priv.health = healthDoc.data() as CamperHealth
      }
      if (demoDoc?.exists()) {
        priv.demographics = demoDoc.data() as Demographics
      }
      return priv
    }

    const applyPrivate = (camperPath: string, priv: PrivateData) => {
      if (!isCurrent()) {
        return
      }
      privateDataMap.current.set(camperPath, priv)
      regDataMap.current.forEach((row, id) => {
        if (row.camper?.path === camperPath) {
          regDataMap.current.set(id, mergePrivate(row, priv))
        }
      })
    }

    const loadPrivateData = async (
      regs: QueryDocumentSnapshot<Registration>[]
    ) => {
      const paths = claimCamperPathsNeedingPrivate(regs)
      if (paths.length === 0) {
        return
      }
      let sinceLastPublish = 0
      await mapWithConcurrency(
        paths,
        PRIVATE_READ_CONCURRENCY,
        async (path) => {
          try {
            applyPrivate(path, await fetchPrivate(path))
          } catch (err) {
            recordError(`failed to load private data for ${path}`, err)
          } finally {
            if (isCurrent()) {
              privateInFlight.current.delete(path)
            }
          }
          // Merge incrementally so health columns fill in as they arrive
          // instead of all at once at the end.
          if (++sinceLastPublish >= PRIVATE_READ_CONCURRENCY) {
            sinceLastPublish = 0
            publish()
          }
        }
      )
      publish()
    }

    // Second pass (every admin role): the family document behind each
    // registration, for the address / household / family-emails columns and
    // the exports. One read per family, cached, merged into every row of that
    // family. Claimed synchronously like the private reads.
    const claimFamilyRefsNeedingLoad = (
      regs: QueryDocumentSnapshot<Registration>[]
    ): DocumentReference<Family>[] => {
      const refs = new Map<string, DocumentReference<Family>>()
      regs.forEach((reg) => {
        const familyRef = reg.data().camper?.parent?.parent as
          | DocumentReference<Family>
          | undefined
        if (
          familyRef &&
          !familyDocMap.current.has(familyRef.id) &&
          !familyInFlight.current.has(familyRef.id)
        ) {
          refs.set(familyRef.id, familyRef)
          familyInFlight.current.add(familyRef.id)
        }
      })
      return Array.from(refs.values())
    }

    const applyFamily = (familyId: string, family: Family) => {
      if (!isCurrent()) {
        return
      }
      familyDocMap.current.set(familyId, family)
      regDataMap.current.forEach((row, id) => {
        if (row.familyId === familyId) {
          regDataMap.current.set(id, { ...row, familyData: family })
        }
      })
    }

    const loadFamilyData = async (
      regs: QueryDocumentSnapshot<Registration>[]
    ) => {
      const refs = claimFamilyRefsNeedingLoad(regs)
      if (refs.length === 0) {
        return
      }
      let sinceLastPublish = 0
      await mapWithConcurrency(refs, PRIVATE_READ_CONCURRENCY, async (ref) => {
        try {
          const fam = await getDoc<Family, DocumentData>(ref)
          if (fam.exists()) {
            applyFamily(ref.id, fam.data())
          }
        } catch (err) {
          recordError(`failed to load family ${ref.id}`, err)
        } finally {
          if (isCurrent()) {
            familyInFlight.current.delete(ref.id)
          }
        }
        if (++sinceLastPublish >= PRIVATE_READ_CONCURRENCY) {
          sinceLastPublish = 0
          publish()
        }
      })
      publish()
    }

    async function combineData() {
      if (!values) {
        return
      }
      // When the Firestore instance flips (prod <-> test mode) this effect
      // fires once more with the previous instance's snapshot before
      // useCollection has reset it. Hydrating that snapshot would read the
      // old database's refs while building sibling paths against the new
      // one — permission errors at best, prod rows in the test view at worst.
      if (values.query.firestore !== firestore) {
        return
      }

      const legacy: QueryDocumentSnapshot<Registration>[] = []
      const changed: QueryDocumentSnapshot<Registration>[] = []

      // Pass 1a: synchronous. Denormalized registrations become rows
      // immediately; legacy ones are queued for the fan-out.
      values.docChanges().forEach((docChange) => {
        const registration = docChange.doc
        if (docChange.type === "removed") {
          regDataMap.current.delete(registration.id)
          return
        }
        changed.push(registration)
        try {
          const data = registration.data()
          if (!isDenormalized(data)) {
            legacy.push(registration)
            return
          }
          const row = buildDenormalizedRow(registration)
          regDataMap.current.set(
            registration.id,
            mergePrivate(row, privateDataMap.current.get(data.camper?.path))
          )
        } catch (err) {
          recordError(`failed to load registration ${registration.id}`, err)
        }
      })
      // The grid renders here: for a current-schema year this is the whole
      // roster after a single query, before any secondary read has started.
      publish()

      // Pass 1b: legacy fan-out, all rows in parallel, each guarded so one
      // broken document (missing camper, lost admin access mid-flight) only
      // drops its own row.
      if (legacy.length > 0) {
        await Promise.all(
          legacy.map(async (registration) => {
            try {
              const row = await buildLegacyRow(registration)
              if (!isCurrent()) {
                return
              }
              regDataMap.current.set(
                registration.id,
                mergePrivate(
                  row,
                  privateDataMap.current.get(registration.data().camper?.path)
                )
              )
            } catch (err) {
              recordError(`failed to load registration ${registration.id}`, err)
            }
          })
        )
        publish()
      }

      // Pass 2: the family document for every row, plus health /
      // demographics for the roles allowed to see them.
      if (isCurrent()) {
        await Promise.all([loadFamilyData(changed), loadPrivateData(changed)])
      }

      if (firstError && isCurrent()) {
        setLoadError(firstError)
      }
    }

    combineData().catch((err: unknown) => {
      if (isCurrent()) {
        setLoadError(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }, [values, adminRole, campYear, firestore])

  return [allData, campYear === null || loading, error ?? loadError]
}

/**
 * Get all the parent names if they exist on the parent and filter them out otherwise
 * @param reg
 * @returns
 */
export const getParentNames = (reg: RegistrationData) =>
  reg.parents
    .map((p) =>
      !!p.firstName && !!p.lastName ? `${p.firstName} ${p.lastName}` : undefined
    )
    .filter((name) => !!name)
    .join(",\n")

/**
 * Get all the parent emails if they're not null.
 * @param reg
 * @returns
 * @param reg
 * @returns
 */
export const getParentEmails = (reg: RegistrationData) =>
  reg.parents
    .map((p) => p.email)
    .filter((email) => !!email)
    .join(", ")

/**
 * Get all the parent emails if they're not null.
 * @param reg
 * @returns
 * @param reg
 * @returns
 */
export const getParentPhoneNumbers = (reg: RegistrationData) =>
  reg.parents
    .map((p) => p.phoneNumber)
    .filter((phoneNumber) => !!phoneNumber)
    .join(", ")
