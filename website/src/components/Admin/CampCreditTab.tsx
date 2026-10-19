import React from "react"
import { collection, doc, getDocs, query, where } from "firebase/firestore"
import { Grid, TextField, Typography } from "@mui/material"
import { useDocumentData } from "react-firebase-hooks/firestore"

import { CampCredit } from "lyf-registration-schemas"
import { ProdContext } from "@components/ProdContext"
import { SnackbarAlertContext } from "@components/SnackbarAlert"
import { AnimatedButtonWithLoading } from "@components/Button"
import AddCampCredit from "./AddCampCredit"

type CampCreditProps = {}

export default function CampCreditTab({}: CampCreditProps) {
  const { firestore } = React.useContext(ProdContext)
  const [email, setEmail] = React.useState<string>("")
  const [familyId, setFamilyId] = React.useState<string>("")
  const [campCreditDoc, setCampCreditDoc] = React.useState<CampCredit | null>(
    null
  )

  const { setSnackbar } = React.useContext(SnackbarAlertContext)

  // Search for the family by email
  const handleSearch = async () => {
    const q = query(
      collection(firestore, "families"),
      where("emails", "array-contains", email)
    )
    const querySnapshot = await getDocs(q)

    if (querySnapshot.empty) {
      setFamilyId("")
      setSnackbar({
        children: "No family found with that email",
        severity: "error",
      })
      return
    }

    // An email can legitimately be listed in more than one family (a parent
    // listed by someone else and their own). Picking one silently would credit
    // the wrong household, so refuse and let the admin resolve it.
    if (querySnapshot.size > 1) {
      setFamilyId("")
      const ids = querySnapshot.docs.map((d) => d.id).join(", ")
      setSnackbar({
        children: `More than one family found with that email (${ids}). Resolve the duplicate before adding credit.`,
        severity: "error",
      })
      return
    }

    setFamilyId(querySnapshot.docs[0].id)
  }

  // Given the family ID, get the camp credit document
  const [campCredit, campCreditLoading, campCreditError] =
    useDocumentData<CampCredit>(
      familyId ? doc(firestore, `/credits/${familyId}`) : null
    )

  return (
    <Grid container justifyContent="center" alignItems="stretch" spacing={2}>
      <Grid size={12}>
        <Typography variant="h4" align="center">
          Find or modify camp Credits
        </Typography>
      </Grid>

      <Grid size={9}>
        <TextField
          id="camp-credit-email"
          label="Email of parent:"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
        />
      </Grid>

      <Grid size={3}>
        <AnimatedButtonWithLoading
          asyncOnClick={handleSearch}
          variant="contained"
          boopProps={{
            scale: 1.05,
          }}
          fullWidth
        >
          Find Family Id
        </AnimatedButtonWithLoading>
      </Grid>

      <Grid size={12}>
        <Typography variant="h5" align="center">
          Family ID: {familyId}
        </Typography>
      </Grid>

      {familyId && (
        <Grid size={6}>
          <AddCampCredit familyId={familyId} />
        </Grid>
      )}
    </Grid>
  )
}
