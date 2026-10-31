import React from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@mui/material"
import ConfettiExplosion from "react-confetti-explosion"

import { LinkButton } from "@components/Button"
import Sparkles from "@components/Sparkles"
import usePrefersReducedMotion from "@hooks/usePrefersReducedMotion"

type OffWaitlistDialogProps = {
  shouldShowDialog: boolean
  camperNames: string[]
}

const combineNames = (names: string[]) =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`

const REGISTRATION_LINK = "/registration?continueFromWaitlist=1"

export default function OffWaitlistDialog({
  shouldShowDialog,
  camperNames,
}: OffWaitlistDialogProps) {
  const [open, setOpen] = React.useState(true)
  const handleClose = () => setOpen(false)
  const prefersReducedMotion = usePrefersReducedMotion()

  return (
    <>
      <Dialog
        open={shouldShowDialog && open}
        onClose={handleClose}
        maxWidth="xl"
      >
        {/* Send a flurry of confetti out from the center of the dialog */}
        <Stack direction="row" justifyContent="center">
          {!prefersReducedMotion && (
            <ConfettiExplosion
              force={0.8}
              duration={2500}
              particleCount={200}
              width={2000}
            />
          )}
        </Stack>

        <DialogTitle textAlign="center">
          <Sparkles>
            Congratulations! {combineNames(camperNames)}{" "}
            {camperNames.length == 1 ? "is" : "are"} off the waitlist!
          </Sparkles>
        </DialogTitle>

        <DialogContent>
          <DialogContentText textAlign="center">
            Please complete registration and payment to confirm your spot at TACL-LYF Camp
          </DialogContentText>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} color="secondary">
            Ignore
          </Button>
          <LinkButton to={REGISTRATION_LINK}>Complete Registration</LinkButton>
        </DialogActions>
      </Dialog>
    </>
  )
}
