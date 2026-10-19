import React from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogTitle,
  Typography,
} from "@mui/material"

// Components
import { CheckoutFlow } from "@components/CheckoutFlow"

// Steps
import ParentGuardianStep from "./ParentGuardianStep"
import FamilyCultureStep from "./FamilyCultureStep"
import SelectNumCampersStep from "./SelectNumCampersStep"
import CamperStep from "./CamperStep"
import DemographicsStep from "./DemographicsStep"
import ReviewStep from "./ReviewStep"
import ConfirmationScreen from "./ConfirmationScreen"

// Registration Data
import { getCampTracksFromCamp } from "lyf-registration-schemas"
import {
  registrationReducer,
  RegistrationDataContext,
  RegistrationDispatchContext,
  RegistrationActionType,
  createEmptyRegistrationData,
} from "./RegistrationDataContext"
import AuthContext from "@components/Auth/AuthContext"
import ProdContext from "@components/ProdContext"

import useFamilyData from "@hooks/useFamilyData"
import useTimeCheck from "@hooks/useTimeCheck"
import useCampYearInfo from "@hooks/useCampYearInfo"
import useCampSchedule from "@hooks/useCampSchedule"
import { FAR_FUTURE, formatCampDate, formatCampTime } from "@utils/campTime"
import WaitlistHeaderBar from "./WaitlistHeaderBar"
import InfoStep from "./InfoStep"

type RegistrationFlowProps = {
  campYear: number
}

const SHOW_WAITLIST_HEADER_BAR = false

export default function RegistrationFlow({ campYear }: RegistrationFlowProps) {
  const { isSignedIn, user, isAdmin } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  // Load data from the server
  const [campInfo, campInfoLoading, campInfoError] = useCampYearInfo(
    campYear,
    firestore
  )
  // Opening times live on camps/{year} (earlyRegOpenDate for pre-registered
  // families, registrationOpenDate for everyone) and are edited from the
  // admin dashboard. A missing date means "not open".
  const schedule = useCampSchedule(campYear)
  const registrationOpenForPreRegistered = schedule.earlyRegOpen ?? FAR_FUTURE
  const registrationOpen = schedule.registrationOpen ?? FAR_FUTURE
  const [familyData, loading, error] = useFamilyData({
    isSignedIn: isSignedIn,
    user: user,
    firestore: firestore,
    includeCampers: true,
    includeParents: true,
    includeRegistrations: true,
  })

  // Parse the data from the server
  const { campers, registrations, campCredit, parents, family } = familyData
  const thisYearsRegistrations = Array.from(registrations.values()).filter(
    (r) => r.campYear === campYear.toString()
  )
  const preRegistrations = thisYearsRegistrations.filter(
    (r) => r.isPreRegistered
  )

  // For some reason campInfo isn't being typed as possibly undefined but we need these checks here.
  const campTracksInfo = campInfo ? getCampTracksFromCamp(campInfo) : []

  // Verify whether the viewer has access to the registration flow depending on the time and pre-registration status.
  const canAccess = useTimeCheck({
    isAdmin,
    isEarlyAccess: preRegistrations.length > 0,
    earlyAccessTimeAfterValid: registrationOpenForPreRegistered,
    timeAfterValid: registrationOpen,
  })

  const [isWaitlistConfirmed, setIsWaitlistConfirmed] = React.useState(true)

  // After we've loaded all the data from the server, we can now setup all the data we need for the registration flow.
  // We use a reducer to manage all the various actions we can take on this data.
  const [registrationData, dispatch] = React.useReducer(
    registrationReducer,
    createEmptyRegistrationData(campYear)
  )
  const camperAndDemographicsEndIndex = registrationData.campers.length * 2 + 2

  const [alertOpen, setAlertOpen] = React.useState(false)
  const handleNoContinue = () => {
    window.localStorage.removeItem("registration")
    setAlertOpen(false)

    // We still want to prefill the signed in parent's info
    const signedInParent = parents.find((p) => p.email === user.email) ?? {
      email: user.email,
      id: user.email,
      ref: null,
    }
    dispatch({
      type: RegistrationActionType.PrefillParent,
      index: 0,
      parent: signedInParent,
    })

    // And prefill the family info
    if (family) {
      dispatch({
        type: RegistrationActionType.PrefillFamily,
        family: family,
      })
    }
  }
  const handleYesContinue = () => {
    dispatch({ type: RegistrationActionType.LoadFromCache })
    setAlertOpen(false)
  }

  React.useEffect(() => {
    const isUserSame = window.localStorage.getItem("user_id") === user.email
    const isCampYearSame =
      window.localStorage.getItem("campYear") === campYear.toString()

    // Any new sessions should use the existing user's email.
    window.localStorage.setItem("user_id", user.email)
    window.localStorage.setItem("campYear", campYear.toString())

    if (!isUserSame || !isCampYearSame) {
      // We have a different user signed in so delete the existing registration and continue without
      // loading the saved registration.
      window.localStorage.removeItem("registration")
      return
    }

    // Parse the current URL to see if there are any query params that we want to apply to the registration form.
    const urlSearchParams = new URLSearchParams(window.location.search)
    if (urlSearchParams.has("success")) {
      if (parseInt(urlSearchParams.get("success"))) {
        // If we succeeded, then we should clear the registration data.
        window.localStorage.removeItem("registration")
        setIsWaitlistConfirmed(
          urlSearchParams.has("waitlist")
            ? parseInt(urlSearchParams.get("waitlist")) == 1
            : false
        )
      } else {
        // Otherwise, let's load the registration data from local storage because they're still in the registration flow.
        dispatch({ type: RegistrationActionType.LoadFromCache })
      }
    } else if (urlSearchParams.has("continueFromWaitlist")) {
      // If we're continuing from the waitlist, then we should load the registration data from the existing camper and registration info. We'll
      // do that action outside this block. But we also want to skip past the existing load from cache screen.
    } else {
      // If success isn't a parameter then this is a new flow.
      // If we have a registration in local storage, then show an alert asking if they want to continue.
      setAlertOpen(
        window && window.localStorage.getItem("registration") != null
      )
    }
  }, [])

  // Listen for changes to the first load of family data.
  // Once it's loaded, if we need to continue from the waitlist, then load all information.
  // Otherwise, if we don't already have existing info, we should prefill it with info we have in our database.
  React.useEffect(() => {
    if (loading) {
      return
    }

    const urlSearchParams = new URLSearchParams(window.location.search)
    if (urlSearchParams.has("success")) {
      return
    }

    // If we're continuing from the waitlist, then we should load the registration data from the
    // from the database.
    if (urlSearchParams.has("continueFromWaitlist")) {
      dispatch({
        type: RegistrationActionType.LoadPendingPaymentRegistrations,
        campYear: campYear,
        familyData: familyData,
      })

      return
    }

    // If we already have something in local storage, we'll use that
    if (window && window.localStorage.getItem("registration") != null) {
      return
    }

    // Otherwise, prefill the signed in parent's info
    const signedInParent = parents.find((p) => p.email === user.email) ?? {
      email: user.email,
      id: user.email,
      ref: null,
    }
    dispatch({
      type: RegistrationActionType.PrefillParent,
      index: 0,
      parent: signedInParent,
    })

    // And prefill the family info
    if (family) {
      dispatch({
        type: RegistrationActionType.PrefillFamily,
        family: family,
      })
    }
  }, [loading])

  return (
    // Provide the context for the registration data and dispatch. This way we don't need to pass them down through each step.
    <RegistrationDataContext.Provider value={registrationData}>
      <RegistrationDispatchContext.Provider value={dispatch}>
        {SHOW_WAITLIST_HEADER_BAR && (
          <WaitlistHeaderBar campTracksInfo={campTracksInfo} />
        )}
        <CheckoutFlow
          title=""
          checkoutStepTitles={[
            { stepIndex: 0, title: "Info" },
            { stepIndex: 1, title: "Parent" },
            {
              stepIndex: 3,
              endIndex: camperAndDemographicsEndIndex,
              title: "Camper",
            },
            {
              stepIndex: camperAndDemographicsEndIndex + 1,
              title: "Family/Household",
            },
            {
              stepIndex: camperAndDemographicsEndIndex + 2,
              title: "Review",
            },
            {
              stepIndex: camperAndDemographicsEndIndex + 3,
              title: "Checkout",
            },
          ]}
          reviewStepIndex={camperAndDemographicsEndIndex + 2}
          loading={loading || schedule.loading}
          canAccess={canAccess}
          blockedComponent={
            <>
              <Typography
                variant="h3"
                textAlign="center"
                sx={{
                  padding: 1,
                }}
              >
                Registration is not yet open
              </Typography>
              <Typography
                variant="h4"
                textAlign="center"
                sx={{
                  padding: 1,
                }}
              >
                {schedule.earlyRegOpen
                  ? `Early Registration will open on ${formatCampDate(
                      schedule.earlyRegOpen
                    )} at ${formatCampTime(
                      schedule.earlyRegOpen
                    )} for pre-registered campers`
                  : "Early Registration dates for pre-registered campers will be announced soon"}
              </Typography>
              <Typography
                variant="h4"
                textAlign="center"
                sx={{
                  padding: 1,
                }}
              >
                {schedule.registrationOpen
                  ? `General Registration will open on ${formatCampDate(
                      schedule.registrationOpen
                    )} at ${formatCampTime(schedule.registrationOpen)}`
                  : "General Registration dates will be announced soon"}
              </Typography>
            </>
          }
          checkoutSteps={[
            <InfoStep
              campTracksInfo={campTracksInfo}
              campYear={campYear}
              infoSessionDate={schedule.infoSessionDate}
            />,
            <ParentGuardianStep />,
            <SelectNumCampersStep
              preRegistrations={preRegistrations}
              campYear={campYear}
            />,
            // Every camper gets a camper and demographic step
            ...registrationData.campers
              .map((camper, index) => [
                <CamperStep
                  camper={camper}
                  camperIndex={index}
                  campersInDatabase={campers}
                  registrations={thisYearsRegistrations}
                  campYear={campYear}
                />,
                <DemographicsStep
                  demographics={registrationData.demographics[index]}
                  demographicsIndex={index}
                />,
              ])
              .flat(),
            <FamilyCultureStep household={registrationData.household} />,
            <ReviewStep
              preRegistrations={preRegistrations}
              campCredit={campCredit}
              campInfo={campInfo}
              campTracksInfo={campTracksInfo}
              setIsWaitlistConfirmed={setIsWaitlistConfirmed}
            />,
          ]}
          completionScreen={
            <ConfirmationScreen
              campYear={campYear}
              hasWaitlist={isWaitlistConfirmed}
            />
          }
          skipToCompletionScreen={false}
        />

        <Dialog
          open={alertOpen}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">
            Continue from your previous session?
          </DialogTitle>
          <DialogActions>
            <Button onClick={handleNoContinue}>No</Button>
            <Button onClick={handleYesContinue} autoFocus>
              Yes
            </Button>
          </DialogActions>
        </Dialog>
      </RegistrationDispatchContext.Provider>
    </RegistrationDataContext.Provider>
  )
}
