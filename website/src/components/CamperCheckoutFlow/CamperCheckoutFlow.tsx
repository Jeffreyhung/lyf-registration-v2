import React from "react"
import { Typography } from "@mui/material"
import { DocumentReference } from "firebase/firestore"

// Components
import { CheckoutFlow } from "@components/CheckoutFlow"

// Steps
import PreRegistrationStep from "./PreRegistrationStep"
import PreRegistrationAgreementStep from "./PreRegistrationAgreementStep"
import DonateStep from "./DonateStep"
import CheckoutStep from "./CheckoutStep"
import ConfirmationScreen from "./ConfirmationScreen"

// Utils
import AuthContext from "@components/Auth/AuthContext"
import ProdContext from "@components/ProdContext"
import {
  Camper,
  DEFAULT_PRE_REGISTRATION_FEE,
  Registration,
  RegistrationStatus,
} from "lyf-registration-schemas"

// Hooks
import useFamilyData, { DocumentIdWithType } from "@hooks/useFamilyData"
import useCampSchedule from "@hooks/useCampSchedule"

type CamperCheckoutFlowProps = {
  campYear: number
  hideCamperCheckout?: boolean
}

export type CamperWithRegistration = DocumentIdWithType<Camper> & {
  activeReg: DocumentReference<Registration> | undefined
  isActiveThisYear: boolean
  isCheckedOut: boolean
  isPreRegisteredForNextYear: boolean
  nextYearPreRegStatus: RegistrationStatus | null
  currentGrade: number | null
}

export default function CamperCheckoutFlow({
  campYear,
  hideCamperCheckout = false,
}: CamperCheckoutFlowProps) {
  const nextCampYear = campYear + 1
  const auth = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  const [familyData, loading, error] = useFamilyData({
    ...auth,
    firestore: firestore,
    includeParents: false,
  })
  const { campers, registrations } = familyData
  const [preRegisteredCampersIds, setPreRegisteredCampersIds] = React.useState<
    string[]
  >([])
  const [donationAmount, setDonationAmount] = React.useState(0)

  // The per-camper price lives on the document of the year being pre-registered
  // for; createPreRegistrationSession prices the Stripe session from the same
  // field, so the two stay in step without a deploy.
  const {
    campInfo,
    loading: campInfoLoading,
    error: campInfoError,
  } = useCampSchedule(nextCampYear)
  const configuredFee = campInfo?.preRegistrationFee
  const hasConfiguredFee =
    typeof configuredFee === "number" && Number.isFinite(configuredFee)
  const preRegistrationFee = hasConfiguredFee
    ? configuredFee
    : DEFAULT_PRE_REGISTRATION_FEE
  React.useEffect(() => {
    if (campInfoLoading || hasConfiguredFee) {
      return
    }
    console.warn(
      `camps/${nextCampYear}.preRegistrationFee is not set; ` +
        `falling back to $${DEFAULT_PRE_REGISTRATION_FEE}`,
      campInfoError ?? ""
    )
  }, [campInfoLoading, hasConfiguredFee, nextCampYear, campInfoError])

  // Combine the camper and registration data
  const campersWithRegistration: CamperWithRegistration[] = campers.map(
    (camper) => {
      // We allow for multiple registrations because it's possible they canceled a pre-registration
      // but then fully registered later.
      const thisYearRegistrations = camper.registrations?.filter((reg) =>
        reg.path.includes(campYear.toString())
      )
      const activeReg = thisYearRegistrations?.find(
        (reg) =>
          registrations.get(reg.path)?.status === RegistrationStatus.ACTIVE
      )

      const nextYearsRegistrations = camper.registrations?.filter((reg) =>
        reg.path.includes(nextCampYear.toString())
      )
      const nextYearPreReg = nextYearsRegistrations?.find(
        (reg) => registrations.get(reg.path)?.isPreRegistered
      )
      const nextYearPreRegStatus = !!nextYearPreReg
        ? (registrations.get(nextYearPreReg.path)?.status as RegistrationStatus)
        : null

      return {
        ...camper,
        activeReg: activeReg,
        isActiveThisYear: !!activeReg,
        isCheckedOut:
          !!activeReg && !!registrations.get(activeReg.path)?.isCheckedOut,
        isPreRegisteredForNextYear: !!nextYearPreReg,
        // null, never false: the pre-registration callable validates this as
        // an integer grade or null.
        currentGrade: activeReg
          ? registrations.get(activeReg.path)?.grade ?? null
          : null,
        nextYearPreRegStatus: nextYearPreRegStatus,
      }
    }
  )

  // We need to filter eventually on only campers who were active this year.
  // Does this need to be memoized?
  const activeCampers = campersWithRegistration.filter(
    (camperWithReg) => camperWithReg.isActiveThisYear
  )
  const checkedOutCampers = activeCampers.filter(
    (camperWithReg) => camperWithReg.isCheckedOut
  )

  return (
    <CheckoutFlow
      title={
        hideCamperCheckout
          ? `LYF Camp ${nextCampYear}  Pre-Registration`
          : "Camper Checkout"
      }
      checkoutStepTitles={[
        { stepIndex: 0, title: "Info" },
        { stepIndex: 1, title: "Pre-Register" },
        { stepIndex: 2, title: "Donate" },
        { stepIndex: 3, title: "Checkout" },
      ]}
      loading={loading || campInfoLoading}
      canAccess={activeCampers.length > 0}
      reviewStepIndex={3}
      blockedComponent={
        <>
          <Typography
            variant="h3"
            textAlign="center"
            sx={{
              padding: 1,
            }}
          >
            You do not have any campers who attended camp this year.
          </Typography>
          <Typography
            variant="h3"
            textAlign="center"
            sx={{
              padding: 1,
            }}
          >
            Only campers who attended camp may pre-register for next year.
          </Typography>
        </>
      }
      checkoutSteps={[
        <PreRegistrationAgreementStep
          hideCamperCheckout={hideCamperCheckout}
          preRegistrationFee={preRegistrationFee}
        />,
        <PreRegistrationStep
          campers={campersWithRegistration}
          preRegisteredCampersIds={preRegisteredCampersIds}
          setPreRegisteredCampersIds={setPreRegisteredCampersIds}
        />,
        <DonateStep
          donationAmount={donationAmount}
          setDonationAmount={setDonationAmount}
        />,
        <CheckoutStep
          nextCampYear={nextCampYear}
          campers={campersWithRegistration}
          preRegisteredCampersIds={preRegisteredCampersIds}
          setPreRegisteredCampersIds={setPreRegisteredCampersIds}
          donationAmount={donationAmount}
          preRegistrationFee={preRegistrationFee}
          hideCamperCheckout={hideCamperCheckout}
        />,
      ]}
      completionScreen={
        <ConfirmationScreen
          campers={campersWithRegistration}
          hideCamperCheckout={hideCamperCheckout}
        />
      }
      skipToCompletionScreen={
        activeCampers.length > 0 &&
        activeCampers.length === checkedOutCampers.length
      }
    />
  )
}
