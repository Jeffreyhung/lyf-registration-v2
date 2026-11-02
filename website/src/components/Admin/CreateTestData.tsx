import React from "react"
import {
  Alert,
  AlertColor,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import {
  collection,
  doc,
  DocumentReference,
  Firestore,
  FirestoreError,
  getDoc,
  getDocs,
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
  normalizeEmail,
} from "lyf-registration-schemas"

type CreateTestDataProps = {
  campYear: number
}

type Action = "add-family" | "add-camper" | "delete-family"

type Status = {
  severity: AlertColor
  message: string
}

/**
 * Thrown for the cases the buttons refuse on purpose (no test family yet,
 * email belongs to a real family, ...). The message is shown as-is.
 */
class TestDataError extends Error {}

const testFamilyId = (email: string) => `${email}_test_family`

/**
 * Resolves the test family for an email. Only the family at
 * families/{email}_test_family (or one explicitly flagged isTestData) counts:
 * a real family that happens to list the email is never reused, so the
 * buttons cannot overwrite or delete production data.
 */
async function findTestFamily(firestore: Firestore, email: string) {
  const byIdRef = doc(firestore, `families/${testFamilyId(email)}`)
  const byId = await getDoc(byIdRef)
  if (byId.exists()) return { ref: byIdRef, exists: true }

  const matches = await getDocs(
    query(
      collection(firestore, "families"),
      where("emails", "array-contains", email)
    )
  )
  const testMatch = matches.docs.find(
    (snap) => (snap.data() as Family).isTestData === true
  )
  if (testMatch) return { ref: testMatch.ref, exists: true }

  if (!matches.empty) {
    throw new TestDataError(
      `${email} already belongs to a real family (${matches.docs
        .map((snap) => snap.id)
        .join(", ")}). Test data is only written to families flagged ` +
        `isTestData, so pick an email that is not on a real family.`
    )
  }

  return { ref: byIdRef, exists: false }
}

function camperRefs(
  firestore: Firestore,
  familyRef: DocumentReference,
  email: string,
  campYear: number,
  index: number
) {
  const registrationRef = doc(
    firestore,
    `camps/${campYear}/registrations/${email}_test_camper_${index}_registration`
  )
  const camperRef = doc(firestore, `${familyRef.path}/campers/test_camper_${index}`)
  return { registrationRef, camperRef }
}

async function addTestFamily(
  firestore: Firestore,
  email: string,
  campYear: number
): Promise<string> {
  const { ref: familyRef, exists } = await findTestFamily(firestore, email)
  const parentsRef = doc(firestore, `${familyRef.path}/parents/${email}`)
  const { registrationRef, camperRef } = camperRefs(
    firestore,
    familyRef,
    email,
    campYear,
    0
  )

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

  batch.set<Camper, Camper>(camperRef, {
    birthDate: "2000-01-01",
    firstName: "Camper",
    lastName: "Test",
    registrations: [registrationRef],
    isTestData: true,
  })

  batch.set<Registration, Registration>(registrationRef, {
    camper: camperRef,
    camperName: "Camper Test",
    shirtSize: "L",
    grade: 10,
    isPreRegistered: true,
    status: RegistrationStatus.ACTIVE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // Lets the test parent see the registration from the family pages; the
    // sync trigger only fills this in when an existing family's emails change.
    familyEmails: [email],
    isTestData: true,
  })

  await batch.commit()

  return exists
    ? `Reset test family ${familyRef.id} and camper "Camper Test" ` +
        `(registration ${registrationRef.id} for ${campYear}).`
    : `Added test family ${familyRef.id} with parent ${email} and camper ` +
        `"Camper Test" (registration ${registrationRef.id} for ${campYear}).`
}

async function addTestCamper(
  firestore: Firestore,
  email: string,
  campYear: number
): Promise<string> {
  const { ref: familyRef, exists } = await findTestFamily(firestore, email)
  if (!exists) {
    throw new TestDataError(
      `No test family exists for ${email} yet. Use "Add Test Family" first.`
    )
  }
  const { registrationRef, camperRef } = camperRefs(
    firestore,
    familyRef,
    email,
    campYear,
    1
  )
  const alreadyThere = (await getDoc(camperRef)).exists()

  const batch = writeBatch(firestore)

  batch.set<Camper, Camper>(camperRef, {
    birthDate: "2010-09-23",
    firstName: "SecondCamper",
    lastName: "Test",
    registrations: [registrationRef],
    isTestData: true,
  })

  batch.set<Registration, Registration>(registrationRef, {
    camper: camperRef,
    camperName: "SecondCamper Test",
    shirtSize: "L",
    grade: 4,
    isPreRegistered: false,
    status: RegistrationStatus.ACTIVE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    familyEmails: [email],
    isTestData: true,
  })

  await batch.commit()

  return `${alreadyThere ? "Reset" : "Added"} camper "SecondCamper Test" in ` +
    `${familyRef.id} (registration ${registrationRef.id} for ${campYear}).`
}

async function deleteTestFamily(
  firestore: Firestore,
  email: string
): Promise<string> {
  const { ref: familyRef, exists } = await findTestFamily(firestore, email)
  if (!exists) {
    throw new TestDataError(
      `No test family found for ${email}; nothing was deleted.`
    )
  }

  const deleteBatch = writeBatch(firestore)
  let parents = 0
  let campers = 0
  let registrations = 0

  const parentsSnapshot = await getDocs(
    collection(firestore, `${familyRef.path}/parents`)
  )
  parentsSnapshot.forEach((parent) => {
    deleteBatch.delete(parent.ref)
    parents++
  })

  const campersSnapshot = await getDocs(
    collection(firestore, `${familyRef.path}/campers`)
  )
  campersSnapshot.docs.forEach((camper) => {
    const camperData = camper.data() as Camper
    ;(camperData.registrations ?? []).forEach((registrationRef) => {
      deleteBatch.delete(registrationRef)
      registrations++
    })
    deleteBatch.delete(camper.ref)
    campers++
  })

  deleteBatch.delete(familyRef)
  await deleteBatch.commit()

  return (
    `Deleted test family ${familyRef.id}: ${parents} parent(s), ` +
    `${campers} camper(s), ${registrations} registration(s).`
  )
}

function describeError(error: unknown): string {
  if (error instanceof TestDataError) return error.message
  if (error instanceof FirestoreError) {
    if (error.code === "permission-denied") {
      return "Firestore rejected the write (permission denied). Only full admins can create test data."
    }
    return `Firestore error (${error.code}): ${error.message}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

const ACTION_LABELS: Record<Action, string> = {
  "add-family": "Add Test Family",
  "add-camper": "Add Test Camper to Family",
  "delete-family": "Delete Test Family",
}

export default function CreateTestData({ campYear }: CreateTestDataProps) {
  const { user } = React.useContext(AuthContext)
  const { firestore, isTestData } = React.useContext(ProdContext)
  const [busy, setBusy] = React.useState<Action | null>(null)
  const [email, setEmail] = React.useState(user?.email ?? "")
  const [status, setStatus] = React.useState<Status | null>(null)

  const normalizedEmail = normalizeEmail(email ?? "")
  const emailInvalid = !normalizedEmail.includes("@")

  const run = async (
    action: Action,
    task: (email: string) => Promise<string>
  ) => {
    if (emailInvalid) {
      setStatus({ severity: "error", message: "Enter a valid email first." })
      return
    }
    setBusy(action)
    setStatus(null)
    try {
      const message = await task(normalizedEmail)
      setStatus({ severity: "success", message })
    } catch (error) {
      console.error(`${ACTION_LABELS[action]} failed`, error)
      setStatus({
        severity: "error",
        message: `${ACTION_LABELS[action]} failed: ${describeError(error)}`,
      })
    } finally {
      setBusy(null)
    }
  }

  const actionButton = (action: Action, onClick: () => void) => (
    <Button
      variant="outlined"
      color={action === "delete-family" ? "error" : "primary"}
      disabled={busy !== null || emailInvalid}
      startIcon={busy === action ? <CircularProgress size={20} /> : undefined}
      onClick={onClick}
    >
      {ACTION_LABELS[action]}
    </Button>
  )

  return (
    <Stack spacing={2} sx={{ maxWidth: 600, mx: "auto", py: 2 }}>
      <Typography variant="h6" textAlign="center">
        Create test data keyed off of the email provided
      </Typography>

      <Alert severity={isTestData ? "info" : "warning"}>
        Writing to the <b>{isTestData ? "test" : "production"}</b> database
        for camp year <b>{campYear}</b>. Documents are flagged{" "}
        <code>isTestData</code>; the buttons only touch families created here
        and never a real family that lists the email.
      </Alert>

      <TextField
        id="test-email"
        label="Email"
        variant="outlined"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        error={email !== "" && emailInvalid}
        helperText={
          email !== "" && emailInvalid
            ? "Enter a valid email"
            : `Family id will be ${testFamilyId(normalizedEmail || "<email>")}`
        }
        disabled={busy !== null}
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {actionButton("add-family", () =>
          run("add-family", (e) => addTestFamily(firestore, e, campYear))
        )}
        {actionButton("add-camper", () =>
          run("add-camper", (e) => addTestCamper(firestore, e, campYear))
        )}
        {actionButton("delete-family", () =>
          run("delete-family", (e) => deleteTestFamily(firestore, e))
        )}
      </Stack>

      {status && (
        <Alert severity={status.severity} onClose={() => setStatus(null)}>
          {status.message}
        </Alert>
      )}
    </Stack>
  )
}
