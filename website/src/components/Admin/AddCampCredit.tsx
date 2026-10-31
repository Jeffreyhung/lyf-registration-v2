import React from "react"
import { doc, increment, arrayUnion, setDoc } from "firebase/firestore"
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  FormControl,
  FormLabel,
  Grid,
  TextField,
} from "@mui/material"

import { SnackbarAlertContext } from "@components/SnackbarAlert"
import { ProdContext } from "@components/ProdContext"
import { NumberInput } from "@components/Inputs"
import { AnimatedButtonWithLoading } from "@components/Button"

type AddCampCredit = {
  familyId: string
}

export default function AddCampCredit({ familyId }: AddCampCredit) {
  const { firestore } = React.useContext(ProdContext)
  const { setSnackbar } = React.useContext(SnackbarAlertContext)

  const [amount, setAmount] = React.useState(0)
  const [reason, setReason] = React.useState("")

  const handleAddCampCredit = async () => {
    const docRef = doc(firestore, `/credits/${familyId}`)
    const familyRef = doc(firestore, `/families/${familyId}`)
    const amountSign = amount > 0 ? "+" : ""
    try {
      await setDoc(
        docRef,
        {
          amountRemaining: increment(amount),
          family: familyRef,
          notes: arrayUnion(`${amountSign}${amount}: ${reason}`),
        },
        { merge: true }
      )

      setSnackbar({
        severity: "success",
        children: `Added ${amountSign}${amount} camp credit`,
      })
    } catch (e) {
      setSnackbar({
        severity: "error",
        children: `Error adding camp credit: ${e}`,
      })
    }
  }

  return (
    <Card>
      <CardHeader title="Add camp credit" />
      <CardContent>
        <Grid
          container
          spacing={2}
          justifyContent="center"
          alignItems="stretch"
        >
          <Grid size={12}>
            <FormControl fullWidth>
              <FormLabel id="camp-credit-amount">Amount</FormLabel>
            </FormControl>
            <NumberInput
              aria-labelledby="camp-credit-amount"
              value={amount}
              onChange={(_e, val) => setAmount(val)}
            />
          </Grid>

          <Grid size={12}>
            <TextField
              id="camp-credit-reason"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              fullWidth
            />
          </Grid>
        </Grid>
      </CardContent>
      <CardActions>
        <AnimatedButtonWithLoading
          asyncOnClick={handleAddCampCredit}
          boopProps={{
            scale: 1.1,
          }}
        >
          Add
        </AnimatedButtonWithLoading>
      </CardActions>
    </Card>
  )
}
