import React from "react"
import {
  Card,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material"
import { Check as CheckIcon, Star as StarIcon } from "@mui/icons-material"

// Schema
import { RegistrationStatus } from "lyf-registration-schemas"

// Components
import { GradientTypography } from "@components/Typography"
import Sparkles from "@components/Sparkles"

// Utils
import { CamperWithRegistration } from "./CamperCheckoutFlow"
import { AnimatedLinkButton } from "@components/Button"

type ConfirmationScreenProps = {
  campers: CamperWithRegistration[]
  hideCamperCheckout?: boolean
}

export default function ConfirmationScreen({
  campers,
  hideCamperCheckout = false,
}: ConfirmationScreenProps) {
  const campersPreRegisteredOrActive = campers.filter(
    (camper) => camper.isPreRegisteredForNextYear || camper.isActiveThisYear
  )
  const didPreRegister =
    campers.find((camper) => camper.isPreRegisteredForNextYear) !== undefined

  // We assume that getting to this point was either a result of an optimistic checkout which we know
  // campers were checked out or on a reload/redirect where we have proper server verification that
  // we're checked out.

  return (
    <Stack spacing={2} alignItems="center">
      <Sparkles>
        <GradientTypography variant="h3" textAlign="center">
          Thank you for attending camp!
        </GradientTypography>
      </Sparkles>

      {didPreRegister && (
        <Typography variant="h6" textAlign="center">
          You have pre-registered for next year's camp! Please check your email
          for the receipt confirmation.
        </Typography>
      )}

      {!hideCamperCheckout && (
        <Typography variant="h6" textAlign="center">
          The following campers have been successfully checked out:
        </Typography>
      )}

      <Card>
        <List sx={{ width: 1 }} aria-label="checked-out-campers">
          {campersPreRegisteredOrActive.map((camper) => (
            <ListItem key={camper.id}>
              {camper.isPreRegisteredForNextYear ? (
                <Tooltip title="Pre-Registered">
                  <ListItemIcon>
                    {/* @ts-expect-error Color type wasn't augmented for this */}
                    <StarIcon color="tertiary" />
                  </ListItemIcon>
                </Tooltip>
              ) : (
                <ListItemIcon>
                  <CheckIcon color="primary" />
                </ListItemIcon>
              )}
              <ListItemText
                primary={`${camper.firstName} ${camper.lastName}`}
                secondary={
                  camper.isPreRegisteredForNextYear
                    ? camper.nextYearPreRegStatus ===
                      RegistrationStatus.PENDING_PAYMENT
                      ? "Pending Pre-Reg Payment"
                      : "Pre-Registered"
                    : undefined
                }
              />
            </ListItem>
          ))}
        </List>
      </Card>

      <AnimatedLinkButton boopProps={{ scale: 1.05 }} to="/">
        Return to Home
      </AnimatedLinkButton>

      {!hideCamperCheckout && (
        <Typography textAlign="center">
          Please show this message to your camper's group counselor for sign off
        </Typography>
      )}
    </Stack>
  )
}
