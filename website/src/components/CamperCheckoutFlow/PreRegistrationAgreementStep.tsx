import React from "react"
import { Box, Stack, Typography } from "@mui/material"

// Components
import { CheckoutFlowStep } from "@components/CheckoutFlow"

type PreRegistrationAgreementStepProps = {
  /** Per-camper price from camps/{nextCampYear}.preRegistrationFee. */
  preRegistrationFee: number
  hideCamperCheckout?: boolean
}

const formatDollars = (amount: number) =>
  `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`

export default function PreRegistrationAgreementStep({
  preRegistrationFee,
  hideCamperCheckout = false,
}: PreRegistrationAgreementStepProps) {
  return (
    <CheckoutFlowStep index={0} hideBack continueText="I understand, continue">
      {!hideCamperCheckout && (
        <Box
          sx={{
            paddingBottom: 2,
          }}
        >
          <Typography variant="h6" textAlign="center">
            Camper Checkout
          </Typography>
          <Typography>
            In order for campers to sign out of camp, they must be checked out
            by a guardian listed on the original registration form. We also have
            an in-person option available at the checkout desk if you're unable
            to complete this form.
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          paddingBottom: 2,
        }}
      >
        <Typography variant="h6" textAlign="center">
          Pre-Registration
        </Typography>
        <Typography>
          On the next screen, you will be able to pre-register your camper for
          next year's LYF camp before spots are open to general public.
          Pre-registration costs {formatDollars(preRegistrationFee)} per camper,
          and you will be notified of the full camp cost in the following
          months. If you cancel before the end of the year, you will be fully
          refunded minus a processing fee. Email reminders will be sent out
          towards the end of the year.
        </Typography>
      </Box>
    </CheckoutFlowStep>
  )
}
