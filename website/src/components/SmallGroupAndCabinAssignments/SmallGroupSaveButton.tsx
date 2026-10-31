import React from "react"
import { AlertProps, CircularProgress } from "@mui/material"
import { Save as SaveIcon } from "@mui/icons-material"
import { Firestore, collection, doc, writeBatch } from "firebase/firestore"

import { Pairings } from "small-group-pairing"
import { AnimatedButton } from "@components/Button"
import ProdContext from "@components/ProdContext"
import {
  CamperMetadata,
  SmallGroupActionType,
  SmallGroupContext,
  SmallGroupDispatchContext,
} from "./SmallGroupContext"

type SmallGroupSaveButtonProps = {
  campYear: number
  setAlertProps: React.Dispatch<React.SetStateAction<AlertProps>>
}

export async function saveRegistrationsToFirebase(
  pairings: Pairings<CamperMetadata>,
  campYear: number,
  firestore: Firestore
): Promise<void> {
  const regCollection = collection(firestore, `camps/${campYear}/registrations`)
  const batch = writeBatch(firestore)

  pairings.campers.forEach((camper) => {
    const camperDoc = doc(firestore, regCollection.path, camper.id)
    batch.update(camperDoc, {
      smallGroup: camper.groupId,
    })
  })

  await batch.commit()
}

export default function SmallGroupSaveButton({
  campYear,
  setAlertProps,
}: SmallGroupSaveButtonProps) {
  const { firestore } = React.useContext(ProdContext)
  const [isLoading, setLoading] = React.useState(false)
  const dispatch = React.useContext(SmallGroupDispatchContext)
  const { pairings, editStack } = React.useContext(SmallGroupContext)

  const onSave = async () => {
    setLoading(true)
    try {
      await saveRegistrationsToFirebase(pairings, campYear, firestore)
      dispatch({ type: SmallGroupActionType.ClearEditStack })
      setAlertProps({
        severity: "success",
        children: "Successfully saved to Firebase",
      })
    } catch (e) {
      setAlertProps({
        severity: "error",
        children: e instanceof Error ? e.message : String(e),
      })
    }
    setLoading(false)
  }

  return (
    <AnimatedButton
      boopProps={{
        scale: 1.05,
      }}
      onClick={onSave}
      startIcon={isLoading ? <CircularProgress size={20} /> : <SaveIcon />}
      disabled={isLoading || editStack.length === 0}
    >
      Save
    </AnimatedButton>
  )
}
