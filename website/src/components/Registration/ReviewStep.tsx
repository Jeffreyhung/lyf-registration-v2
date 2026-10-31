import React from "react"
import { Grid, Stack, TextField, Typography } from "@mui/material"
import { httpsCallable } from "firebase/functions"
import { FUNCTION_NAMES } from "lyf-registration-schemas"

// Schemas
import {
  CampTrackInfo,
  CampYear,
  RegistrationPayload,
  getClientRequiredCamperFields,
  getClientRequiredRegistrationFields,
} from "lyf-registration-schemas"

// Local Components
import ReviewStepEdit from "./ReviewStepEdit"
import ProdContext from "@components/ProdContext"
import { AnimatedButtonWithLoading } from "@components/Button"
import { SnackbarAlertContext } from "@components/SnackbarAlert"
import CheckoutFlowContext from "@components/CheckoutFlow/CheckoutFlowContext"

import { RegistrationDocumentWithCamperId } from "@hooks/useFamilyData"
import { firebaseFunctions } from "@utils/firebaseApp"

// Registration Data Context
import {
  RegistrationActionType,
  RegistrationData,
  RegistrationDataContext,
  RegistrationDispatchContext,
} from "./RegistrationDataContext"
import ReviewStepOrderSummaryItems from "./ReviewStepOrderSummaryItems"

type ReviewStepProps = {
  preRegistrations: RegistrationDocumentWithCamperId[]
  campCredit: number
  campInfo: CampYear
  campTracksInfo: CampTrackInfo[]
  setIsWaitlistConfirmed: React.Dispatch<React.SetStateAction<boolean>>
}

type RegistrationSessionInputResponse = {
  isWaitlist?: boolean
  sessionId?: string
  status?: string
  code?: number
  message?: string
}

const createRegistrationSession = httpsCallable<
  RegistrationPayload,
  RegistrationSessionInputResponse
>(firebaseFunctions, FUNCTION_NAMES.createRegistrationSession)

type CreateCheckoutSessionResponse = Promise<{
  success: boolean
  sessionId: string | null
  isWaitlist: boolean
  errorMsg: string | null
}>

async function createCheckoutSession(
  registrationData: RegistrationData,
  isTestData: boolean
): CreateCheckoutSessionResponse {
  const basePath = `${window.location.origin}${window.location.pathname}`

  // Firebase has trouble parsing DocumentReferences when encoding the payload into JSON.
  // Since some parents have registrations saved locally, we should temporarily remove
  // the campers object here to fix the encoding.
  // Make sure that all Firebase references are removed from here.
  const { campers, ...restOfRegistrationData } = registrationData

  try {
    const response = await createRegistrationSession({
      ...restOfRegistrationData,
      campers: campers.map(
        ({ registrations, ...restOfCamper }) => restOfCamper
      ),
      successUrl: `${basePath}?success=1`,
      cancelUrl: `${basePath}?success=0`,
      isTestData: isTestData,
    })

    const success =
      response.data.status === "success" || response.data.sessionId != null

    return {
      success: success,
      sessionId: response.data.sessionId,
      isWaitlist: response.data.isWaitlist ?? false,
      errorMsg:
        success || response.data.isWaitlist
          ? null
          : `Unable to create a Stripe checkout session. Please try again later or contact us at lyf@tacl.org`,
    }
  } catch {
    return {
      success: false,
      sessionId: null,
      errorMsg: `Unable to contact our server. Please try again later or contact us at lyf@tacl.org`,
      isWaitlist: false,
    }
  }
}

export default function ReviewStep({
  preRegistrations,
  campCredit,
  campInfo,
  campTracksInfo,
  setIsWaitlistConfirmed,
}: ReviewStepProps) {
  const registrationData = React.useContext(RegistrationDataContext)
  const dispatch = React.useContext(RegistrationDispatchContext)
  const { setSnackbar } = React.useContext(SnackbarAlertContext)
  const { setActiveStep } = React.useContext(CheckoutFlowContext)
  const { isTestData, getStripe } = React.useContext(ProdContext)

  const [donation, setDonation] = React.useState<string>(
    registrationData.donation.toString()
  )

  const donationIsInvalid =
    Number.isNaN(donation) || Number.parseFloat(donation) < 0
  const handleDonation: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const val = event.target.value
    setDonation(val)

    dispatch({
      type: RegistrationActionType.SetDonation,
      donation:
        val === "" || Number.isNaN(val)
          ? 0
          : Math.max(Number.parseFloat(val), 0),
    })
  }

  // Calculate any missing fields
  const camperMissingFields = registrationData.campers.map(
    (camperRegistration) => {
      const missingFields: string[] = []
      const camperRequiredResult =
        getClientRequiredCamperFields(camperRegistration)
      // We use false here to coerce the hasAllFields case to false. Otherwise, Typescript gets confused.
      if (camperRequiredResult.hasAllFields == false) {
        missingFields.push(...camperRequiredResult.missingFields)
      }

      const registrationRequiredResult =
        getClientRequiredRegistrationFields(camperRegistration)
      // We use false here to coerce the hasAllFields case to false. Otherwise, Typescript gets confused.
      if (registrationRequiredResult.hasAllFields == false) {
        missingFields.push(...registrationRequiredResult.missingFields)
      }

      return missingFields
    }
  )
  const hasMissingRequiredFields =
    camperMissingFields.reduce(
      (allMissingFields, currentMissingFields) => [
        ...allMissingFields,
        ...currentMissingFields,
      ],
      []
    ).length > 0

  const handleStripeCheckout = async () => {
    const response = await createCheckoutSession(registrationData, isTestData)

    const { success, errorMsg, sessionId, isWaitlist } = response
    if (!sessionId && (success || isWaitlist)) {
      setIsWaitlistConfirmed(isWaitlist)
      setActiveStep(1000)
      window.localStorage.removeItem("registration")
      return
    }

    if (!sessionId || errorMsg) {
      setSnackbar({
        children: response.errorMsg,
        severity: "error",
      })

      return
    }

    const stripe = await getStripe()
    if (!stripe) {
      setSnackbar({
        children:
          "Unable to connect to Stripe. Please try again later or contact us at lyf@tacl.org",
        severity: "error",
      })

      return
    }

    await stripe.redirectToCheckout({
      sessionId: sessionId,
    })
  }

  return (
    <Grid
      container
      sx={{ padding: { xs: 2, lg: 6 } }}
      spacing={4}
      alignItems="flex-start"
    >
      {/* Title */}
      <Grid size={12}>
        <Typography variant="h2">Let's Review!</Typography>
      </Grid>

      {/* Main Content */}
      <Grid
        container
        size={{ xs: 12, lg: 7 }}
        gap={2}
        sx={{
          borderStyle: "solid",
          borderColor: "palette.lightgray",
          borderWidth: 1,
          borderRadius: 2,
          margin: 2,
          padding: 2,
        }}
      >
        <Stack sx={{ width: 1 }} spacing={1}>
          {/* Parents */}
          <Typography variant="h4" sx={{ paddingTop: 2 }}>
            Parent/Guardian Information
          </Typography>
          {registrationData.parents.map((parent, index) => (
            <ReviewStepEdit
              title={`Parent ${index + 1}`}
              key={`review-step-edit-parents-${index}`}
              stepIndex={1}
              values={[
                {
                  key: "Name",
                  value: `${parent.firstName} ${parent.lastName}`,
                },
                {
                  key: "Email",
                  value: parent.email,
                },
                {
                  key: "Phone Number",
                  value: parent.phoneNumber,
                },
              ]}
            />
          ))}

          {/* Campers */}
          <Typography variant="h4" sx={{ paddingTop: 2 }}>
            Camper Information
          </Typography>
          {registrationData.campers.map((camper, index) => (
            <ReviewStepEdit
              title={`Camper ${index + 1}`}
              key={`review-step-edit-campers-${index}`}
              stepIndex={index * 2 + 3}
              missingFields={camperMissingFields[index]}
              values={[
                {
                  key: "Name",
                  value: `${camper.firstName} ${camper.lastName}`,
                },
                {
                  key: "Camp Track",
                  value: camper.campTrack,
                },
                {
                  key: "Birthday",
                  value: camper.birthDate,
                },
                {
                  key: "Gender",
                  value: camper.gender?.join(", "),
                },
                {
                  key: "Grade",
                  value: camper.grade,
                },
                {
                  key: "T-Shirt Size (Adult)",
                  value: camper.shirtSize,
                },
                {
                  key: "Diet/Food",
                  value: camper.dietAndFoodAllergies,
                },
                {
                  key: "Medical",
                  value: camper.medicalConditions,
                },
              ]}
            />
          ))}

          {/* Demographics */}
          <Typography variant="h4" sx={{ paddingTop: 2 }}>
            Demographics
          </Typography>
          {registrationData.demographics.map((demographics, index) => (
            <ReviewStepEdit
              title={`Camper ${index + 1}`}
              key={`review-step-edit-demographics-${index}`}
              stepIndex={index * 2 + 4}
              values={[
                {
                  key: "Birthplace",
                  value: demographics.born ?? "",
                },
                {
                  key: "Ethnicity",
                  value: demographics ? "" : demographics.ethnicity.join(", "),
                },
                {
                  key: "Generation",
                  value: demographics.generation ?? "",
                },
                {
                  key: "Mandarin Fluency",
                  value: demographics.mandarinLanguage ?? "",
                },
                {
                  key: "Hokkien Fluency",
                  value: demographics.hokkienLanguage ?? "",
                },
                {
                  key: "Hakka Fluency",
                  value: demographics.hakkaLanguage ?? "",
                },
                {
                  key: "Immediate Family",
                  value: demographics.immediateFamily ?? "",
                },
                {
                  key: "Additional Background",
                  value: demographics.otherBackground ?? "",
                },
              ]}
            />
          ))}

          {/* Household Culture */}
          <Typography variant="h4" sx={{ paddingTop: 2 }}>
            Household Information
          </Typography>
          <ReviewStepEdit
            title={`Household`}
            key={`review-step-edit-household`}
            stepIndex={registrationData.campers.length * 2 + 3}
            values={[
              {
                key: "Camper Message",
                value: registrationData.household.camperMessage,
              },
              {
                key: "Heritage Language Frequency",
                value: registrationData.household.languageFrequency,
              },
              {
                key: "Familiarity with Taiwanese Holidays and Traditions",
                value: registrationData.household.cultureConfidence,
              },
              {
                key: "Taiwanese Culture Interests",
                value: registrationData.household.cultureLearn,
              },
              {
                key: "Barriers to Taiwanese Culture",
                value: registrationData.household.cultureBarrier,
              },
              {
                key: "Culture Lesson for your Camper(s)",
                value: registrationData.household.cultureLesson,
              },
            ]}
          />
        </Stack>
      </Grid>

      {/* Order Summary */}
      <Grid size={{ xs: 12, lg: 4, xl: 3 }} sx={{ padding: 0 }}>
        <Stack width={1} sx={{ padding: 0 }}>
          <Grid
            container
            alignItems="stretch"
            spacing={1}
            sx={{
              borderStyle: "solid",
              borderColor: "secondary.main",
              borderRadius: 2,
              borderWidth: 1,
              margin: 2,
              width: 1,
              padding: 2,
            }}
          >
            <Grid size={12}>
              <Typography variant="h5" textAlign="center">
                Order Summary
              </Typography>
            </Grid>
            <Grid size={12}>
              <ReviewStepOrderSummaryItems
                campCredit={campCredit}
                campInfo={campInfo}
                campTracksInfo={campTracksInfo}
                donation={registrationData.donation}
                preRegistrations={preRegistrations}
                registrationData={registrationData}
              />
            </Grid>

            {/* Here to force a new line */}
            <Grid size={12} sx={{ padding: 1 }} />

            {registrationData.donation > 0 && (
              <Grid size={12}>
                <Typography variant="h6" color="secondary" textAlign="center">
                  Thank you for your donation!
                </Typography>
              </Grid>
            )}

            <Grid size={12}>
              <TextField
                id="donation-amount"
                label="Add a donation"
                color="secondary"
                fullWidth
                value={donation}
                onChange={handleDonation}
                error={donationIsInvalid}
                type="number"
                InputProps={{
                  type: "number",
                  startAdornment: "$",
                }}
              />
            </Grid>

            <Grid size={12}>
              <AnimatedButtonWithLoading
                fullWidth
                variant="contained"
                color="secondary"
                disabled={hasMissingRequiredFields}
                boopProps={{
                  scale: 1.05,
                }}
                asyncOnClick={handleStripeCheckout}
              >
                Checkout
              </AnimatedButtonWithLoading>
              {hasMissingRequiredFields && (
                <Typography color="error" textAlign="center">
                  Missing required fields
                </Typography>
              )}
            </Grid>
          </Grid>

          {/* Tax Info */}
          {registrationData.donation > 0 && (
            <Typography variant="body1" textAlign="center" padding={2}>
              TACL-LYF is a U.S. nonprofit, tax-exempt charitable organization
              (EIN 33-0086639) under Section 501(c)(3) of the U.S. Internal
              Revenue Code. Please email us at lyf@tacl.org for a donation
              receipt.
            </Typography>
          )}
        </Stack>
      </Grid>
    </Grid>
  )
}
