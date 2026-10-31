import React from "react"
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import {
  collection,
  doc,
  getDocs,
  Firestore,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore"

import AuthContext from "@components/Auth/AuthContext"
import { ProdContext } from "@components/ProdContext"

import {
  Family,
  Parent,
  Camper,
  Registration,
  RegistrationStatus,
} from "lyf-registration-schemas"

type CreateTestCamperProps = {
  campYear: number
}

async function getFamilyRefs(
  firestore: Firestore,
  email: string,
  campYear: number,
  index: number
) {
  const familyId = `${email}_test_family`
  const familiesQuery = query(
    collection(firestore, "families"),
    where("emails", "array-contains", email)
  )

  const familiesSnapshot = await getDocs(familiesQuery)
  const familyRef =
    familiesSnapshot.docs.length == 1
      ? familiesSnapshot.docs[0].ref
      : doc(firestore, `families/${familyId}`)

  const parentsRef = doc(firestore, `${familyRef.path}/parents/${email}`)
  const registrationRef = doc(
    firestore,
    `/camps/${campYear}/registrations/${email}_test_camper_${index}_registration`
  )
  const camperRef = doc(
    firestore,
    `${familyRef.path}/campers/test_camper_${index}`
  )

  return { familyId, familyRef, parentsRef, registrationRef, camperRef }
}

async function addTestFamily(
  firestore: Firestore,
  email: string,
  campYear: number
) {
  const { familyRef, parentsRef, registrationRef, camperRef } =
    await getFamilyRefs(firestore, email, campYear, 0)

  const batch = writeBatch(firestore)

  batch.set<Family, Family>(familyRef, {
    city: "CityTest",
    emails: [email],
    state: "StateTest",
    street: "1000 Test Street",
    zip: "00000",
    isTestData: true,
  })

  batch.set<Parent, Parent>(parentsRef, {
    email: email,
    firstName: "Test",
    lastName: "Parent",
    lineId: null,
    phoneNumber: "(000) 000-0000",
  })

  // Eventually we want this to be extensible and delete it but for now we're
  // just going to hardcode a camper id
  batch.set<Camper, Camper>(camperRef, {
    birthDate: "2000-01-01",
    firstName: "Camper",
    lastName: "Test",
    registrations: [registrationRef],
    isTestData: true,
  })

  // Now create the registration we referenced above.
  batch.set<Registration, Registration>(registrationRef, {
    camper: camperRef,
    camperName: "Camper Test",
    shirtSize: "L",
    grade: 10,
    isPreRegistered: true,
    status: RegistrationStatus.ACTIVE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isTestData: true,
  })

  await batch.commit()
}

async function addTestCamper(
  firestore: Firestore,
  email: string,
  campYear: number
) {
  const { registrationRef, camperRef } = await getFamilyRefs(
    firestore,
    email,
    campYear,
    1
  )

  const batch = writeBatch(firestore)

  // Eventually we want this to be extensible and delete it but for now we're
  // just going to hardcode a camper id
  batch.set<Camper, Camper>(camperRef, {
    birthDate: "2010-09-23",
    firstName: "SecondCamper",
    lastName: "Test",
    registrations: [registrationRef],
    isTestData: true,
  })

  // Now create the registration we referenced above.
  batch.set<Registration, Registration>(registrationRef, {
    camper: camperRef,
    camperName: "SecondCamper Test",
    shirtSize: "L",
    grade: 4,
    isPreRegistered: false,
    status: RegistrationStatus.ACTIVE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isTestData: true,
  })

  await batch.commit()
}

async function deleteTestFamily(
  firestore: Firestore,
  email: string,
  campYear: number
) {
  const { familyRef } = await getFamilyRefs(firestore, email, campYear, 0)

  console.log(`Deleting ${familyRef.id}`)
  const deleteBatch = writeBatch(firestore)

  const parentsQuery = query(collection(firestore, `${familyRef.path}/parents`))

  const parentsSnapshot = await getDocs(parentsQuery)
  parentsSnapshot.forEach((parent) => {
    deleteBatch.delete(parent.ref)
  })

  const campersQuery = query(collection(firestore, `${familyRef.path}/campers`))

  const campersSnapshot = await getDocs(campersQuery)

  // Delete all the registrations associated with the campers.
  campersSnapshot.docs.forEach((camper) => {
    const camperData = camper.data() as Camper
    // Find every registration associated with the camper.
    const registrations = camperData.registrations ?? []
    registrations.forEach((registrationRef) => {
      deleteBatch.delete(registrationRef)
    })
    deleteBatch.delete(camper.ref)
  })

  // Recursively deletes all the campers and parents associated with the family.
  deleteBatch.delete(familyRef)

  // Commit the batch
  await deleteBatch.commit()
}

export default function CreateTestCamper({ campYear }: CreateTestCamperProps) {
  const { user } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  const [loading, setLoading] = React.useState(false)
  const [email, setEmail] = React.useState(user?.email)

  return (
    <Stack>
      <Typography variant="h6" textAlign="center">
        Create test data keyed off of the email provided
      </Typography>
      <TextField
        id="test-email"
        label="Email"
        variant="outlined"
        defaultValue={user?.email}
        onChange={(event) => setEmail(event.currentTarget.value)}
      />
      <Button
        startIcon={loading && <CircularProgress size={25} />}
        onClick={async () => {
          setLoading(true)
          await addTestFamily(firestore, email as string, campYear)
          setLoading(false)
        }}
      >
        Add Test Family
      </Button>
      <Button
        startIcon={loading && <CircularProgress size={25} />}
        onClick={async () => {
          setLoading(true)
          await addTestCamper(firestore, email as string, campYear)
          setLoading(false)
        }}
      >
        Add Test Camper to Family
      </Button>
      <Button
        startIcon={loading && <CircularProgress size={25} />}
        onClick={async () => {
          setLoading(true)
          await deleteTestFamily(firestore, email as string, campYear)
          setLoading(false)
        }}
      >
        Delete Test Family
      </Button>
    </Stack>
  )
}
