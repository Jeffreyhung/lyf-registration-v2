import { useState, useEffect } from "react"
import { useCollectionOnce } from "react-firebase-hooks/firestore"
import {
  collection,
  query,
  Firestore,
  where,
  onSnapshot,
  DocumentReference,
  getDoc,
  doc,
  getCountFromServer,
  documentId,
} from "firebase/firestore"
import { User } from "firebase/auth"

// Utils
import {
  Camper,
  CamperHealth,
  Family,
  Parent,
  Registration,
  RegistrationStatus,
  isEstablishedFamilyMember,
} from "lyf-registration-schemas"

export type DocumentIdWithType<T> = T & {
  ref: DocumentReference<T>
  id: string
}

// Health lives in a role-gated sub-document (campers/{id}/private/health);
// family members may read and update it, so it's loaded alongside the camper.
export type CamperWithHealth = DocumentIdWithType<Camper> & {
  health: CamperHealth
}

type UseFamilyDataProps = {
  isSignedIn: boolean
  user: User | null
  firestore: Firestore
  campYear?: string
  includeParents?: boolean
  includeCampers?: boolean
  includeRegistrations?: boolean
  includeWaitlistPosition?: boolean
}

export type RegistrationDocumentWithCamperId =
  DocumentIdWithType<Registration> & {
    camperId: string
    campYear: string
    waitlistPosition: number | null
  }

export type FamilyData = {
  family: DocumentIdWithType<Family> | null
  parents: DocumentIdWithType<Parent>[]
  campers: CamperWithHealth[]
  registrations: Map<string, RegistrationDocumentWithCamperId>
  campCredit: number
}

// We return an object rather than a string because we should only need to call this hook once in a component.
type UseFamilyDataReturn = [FamilyData, boolean, string | undefined]

function createMap() {
  return new Map()
}

// Should we use a reducer to manage updating the family information? Ex: dispatch an action to update the camper, parent, registration, etc.

export default function useFamilyData({
  isSignedIn,
  user,
  firestore,
  campYear,
  includeCampers = true,
  includeParents = true,
  includeRegistrations = true,
  includeWaitlistPosition = false,
}: UseFamilyDataProps): UseFamilyDataReturn {
  // If the user isn't even signed in, then ignore

  // Store the data in various maps.
  const [family, setFamily] = useState<DocumentIdWithType<Family> | null>(null)
  const [campers, setCampers] =
    useState<Map<string, CamperWithHealth>>(createMap)
  const [parents, setParents] =
    useState<Map<string, DocumentIdWithType<Parent>>>(createMap)
  const [registrations, setRegistrations] =
    useState<Map<string, RegistrationDocumentWithCamperId>>(createMap)
  // TODO We're eventually removing camp credits
  const [campCredit, setCampCredit] = useState<number>(0)
  const [familyLoading, setFamilyLoading] = useState(true)
  const [camperRegistrationLoading, setCamperRegistrationLoading] = useState(
    includeCampers || includeRegistrations
  )
  const [registrationLoading, setRegistrationLoading] = useState(
    includeCampers && includeRegistrations
  )
  const [parentLoading, setParentLoading] = useState(includeParents)

  // If one day we wanted to also keep track of registration listeners, then we would need this
  // const [registrationsToKeepTrackOf, setRegistrationsToKeepTrackOf] = useState<
  //   Set<string>
  // >(new Set()) // We use strings because Sets use object reference equality.

  // This could be multiple families but we're going to limit to 1 with maybe a log that we got 2?
  const [familyDocs, familyDocsLoading] = useCollectionOnce<Family>(
    query(
      isSignedIn ? collection(firestore, "families") : null,
      isSignedIn ? where("emails", "array-contains", user?.email) : null
    )
  )

  /* Helper for querying waitlist position of a registration */
  const waitlistPosition = async (
    r: DocumentIdWithType<Registration>
  ): Promise<number | null> => {
    return !(
      includeWaitlistPosition &&
      r.status === RegistrationStatus.WAITLIST &&
      r.ref.parent.parent.id === campYear
    )
      ? null
      : (
          await getCountFromServer(
            query(
              collection(firestore, r.ref.parent.path),
              where("status", "==", RegistrationStatus.WAITLIST),
              where("campTrack", "==", r.campTrack),
              where("waitlistTime", "<=", r.waitlistTime ?? null)
            )
          )
        ).data().count
  }

  // When the familyDocs loads, we can set family.
  useEffect(() => {
    if (!familyDocs || familyDocs.docs.length <= 0) {
      setFamilyLoading(familyDocsLoading)
      setCamperRegistrationLoading(
        (includeCampers || includeRegistrations) && familyDocsLoading
      )
      setParentLoading(includeParents && familyDocsLoading)
      return undefined
    }

    // A user can be listed in more than one family if someone else named them
    // as a co-parent. Prefer the family they are an established member of;
    // fall back to the first match (the registration flow asks the user to
    // confirm such a family before registering into it).
    const family =
      (user?.email &&
        familyDocs.docs.find((d) =>
          isEstablishedFamilyMember(d.data(), user.email as string)
        )) ||
      familyDocs.docs[0]

    // Get any camp credits this family has
    // TODO Remove camp credit
    const campCreditRef = doc(firestore, `/credits/${family.id}`)
    getDoc(campCreditRef)
      .then((creditDoc) => {
        setCampCredit(creditDoc.get("amountRemaining") ?? 0)
      })
      .catch(() => {
        setCampCredit(0)
      })

    // Create a campers collection listener.
    const campersCollection = collection(
      firestore,
      `${family.ref.path}/campers`
    )
    const unsubscribeCampersCollectionListener = includeCampers
      ? onSnapshot(
          // @ts-expect-error Ignore collection for now
          query<Camper>(campersCollection),
          async (camperSnapshot) => {
            // First run, the entire map changes
            // Second run, only one doc updates
            // Compile all of the docs that changed then update in one go.
            const newCamperMap = new Map()
            const newRegistrations = new Map<
              string,
              RegistrationDocumentWithCamperId
            >()

            await Promise.all(
              camperSnapshot.docChanges().map(async (camper) => {
                let health: CamperHealth = {}
                try {
                  const healthDoc = await getDoc(
                    doc(firestore, `${camper.doc.ref.path}/private/health`)
                  )
                  if (healthDoc.exists()) health = healthDoc.data() as CamperHealth
                } catch {
                  // Not readable — leave empty
                }
                const data: CamperWithHealth = {
                  ...camper.doc.data(),
                  ref: camper.doc.ref,
                  id: camper.doc.id,
                  health,
                }
                newCamperMap.set(camper.doc.id, data)

                // If there are registrations for the camper, then
                // fetch the registration data. We only fetch registrations
                // that we haven't already fetched data for. That means
                // we don't actually listen for any changes to registration data.
                const camperRegistrations = camper.doc.data().registrations
                if (includeRegistrations && camperRegistrations) {
                  await Promise.all(
                    camperRegistrations.map(async (reg) => {
                      if (!newRegistrations.has(reg.path)) {
                        const registrationDoc = await getDoc(
                          doc(firestore, reg.path)
                        )
                        newRegistrations.set(reg.path, {
                          ...registrationDoc.data(),
                          ref: registrationDoc.ref,
                          id: registrationDoc.id,
                          camperId: camper.doc.id,
                          campYear: reg.parent.parent.id,
                          waitlistPosition: await waitlistPosition({
                            ...registrationDoc.data(),
                            ref: registrationDoc.ref,
                            id: registrationDoc.id,
                          }),
                        })
                      }
                    })
                  )
                }
              })
            )
            setCampers((map) => new Map([...map, ...newCamperMap]))
            setRegistrations((map) => new Map([...map, ...newRegistrations]))

            // At this point we're done loading the campers and registrations, so
            // if we don't need to include the parents, then we're done loading.
            setCamperRegistrationLoading(false)
          }
        )
      : () => {}

    // Create a parents collection listener.
    const parentsCollection = collection(
      firestore,
      `${family.ref.path}/parents`
    )
    const unsubscribeParentsCollectionListener = includeParents
      ? onSnapshot(
          // @ts-expect-error Ignore collection for now
          query<Parent>(parentsCollection),
          async (parentSnapshot) => {
            // First run, the entire map changes
            // Second run, only one doc updates
            // Compile all of the docs that changed then update in one go.
            const newParentMap = new Map()
            await Promise.all(
              parentSnapshot.docChanges().map(async (parent) => {
                newParentMap.set(parent.doc.id, {
                  ...parent.doc.data(),
                  ref: parent.doc.ref,
                  id: parent.doc.id,
                })
              })
            )
            setParents((map) => new Map([...map, ...newParentMap]))
            setParentLoading(false)
          }
        )
      : () => {}

    setFamily({ ...family.data(), ref: family.ref, id: family.id })
    setFamilyLoading(false)
    return () => {
      unsubscribeCampersCollectionListener()
      unsubscribeParentsCollectionListener()
    }
  }, [familyDocs, familyDocsLoading])

  useEffect(() => {
    if (camperRegistrationLoading) {
      return undefined
    }

    // A camper that has never registered has no `registrations` field
    const camperRegistrations = Array.from(campers)
      .reduce(
        (prev, [, c]) => prev.concat(c.registrations ?? []),
        new Array<DocumentReference<Registration>>()
      )
      .map((r) => r.id)

    if (camperRegistrations.length <= 0 || !campYear) {
      setRegistrationLoading(false)
      return undefined
    }

    return onSnapshot(
          // @ts-expect-error Ignore collection for now
          query<Registration>(
            collection(firestore, `camps/${campYear}/registrations`),
            where(documentId(), "in", camperRegistrations)
          ),
          async (registrationSnapshot) => {
            const newRegistrations = new Map<
              string,
              RegistrationDocumentWithCamperId
            >()
            await Promise.all(
              registrationSnapshot.docChanges().map(async (r) => {
                const registrationData = r.doc.data()
                newRegistrations.set(r.doc.ref.path, {
                  ...registrationData,
                  ref: r.doc.ref,
                  id: r.doc.id,
                  camperId: registrationData.camper.id,
                  campYear: r.doc.ref.parent.parent.id,
                  waitlistPosition: await waitlistPosition({
                    ...registrationData,
                    ref: r.doc.ref,
                    id: r.doc.id,
                  }),
                })
              })
            )
            setRegistrations((map) => new Map([...map, ...newRegistrations]))
            setRegistrationLoading(false)
          }
        )
  }, [campers, camperRegistrationLoading])

  return [
    {
      family: family,
      campers: Array.from(campers.values()),
      parents: Array.from(parents.values()),
      registrations: registrations,
      campCredit,
    },
    familyLoading ||
      camperRegistrationLoading ||
      registrationLoading ||
      parentLoading,
    undefined,
  ]
}
