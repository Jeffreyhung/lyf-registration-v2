import React from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
import {
  getCampTracksFromCamp,
  isEstablishedFamilyMember,
} from "lyf-registration-schemas"
import {
  registrationReducer,
  RegistrationDataContext,
  RegistrationDispatchContext,
  RegistrationActionType,
  createEmptyRegistrationData,
  REGISTRATION_STORAGE_KEY,
  clearSavedRegistration,
  readSavedRegistrationSession,
  saveRegistrationStep,
  SavedRegistrationSession,
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

// Step layout for a given number of campers: Info, Parent, number of
// campers, then a Camper and a Demographics step per camper, Family/Household,
// Review and Checkout. Shared by the stepper and the resume dialog so both
// name the same step for the same index.
function registrationSteps(numCampers: number) {
  const camperAndDemographicsEndIndex = numCampers * 2 + 2
  const titles = [
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
  ]
  return { reviewStepIndex: camperAndDemographicsEndIndex + 2, titles }
}

function stepTitleAt(numCampers: number, index: number) {
  // Step 2 (number of campers) has no label of its own; it belongs to Camper.
  if (index === 2) {
    return "Camper"
  }
  const { titles } = registrationSteps(numCampers)
  const match = titles.find(
    ({ stepIndex, endIndex }) =>
      index >= stepIndex && index <= (endIndex ?? stepIndex)
  )
  return match?.title ?? "Review"
}

// One sentence on what "Continue" would bring back, so the family can tell
// whether it is the registration they remember.
function describeSavedSession({ data, step }: SavedRegistrationSession) {
  const parent = data.parents?.[0]
  const parentName = [parent?.firstName, parent?.lastName]
    .filter(Boolean)
    .join(" ")
  const camperNames = (data.campers ?? [])
    .map((c) => [c.firstName, c.lastName].filter(Boolean).join(" "))
    .filter(Boolean)
  const numCampers = data.campers?.length ?? 0
  const campers = `${numCampers} camper${numCampers === 1 ? "" : "s"}${
    camperNames.length > 0 ? ` (${camperNames.join(", ")})` : ""
  }`
  const who = parentName ? `${parentName}'s registration` : "A registration"
  return `${who} with ${campers} was saved on this device, last on the ${stepTitleAt(
    numCampers,
    step
  )} step.`
}

export default function RegistrationFlow({ campYear }: RegistrationFlowProps) {
  const { isSignedIn, user, isAdmin } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  // Load data from the server
  const [campInfo] = useCampYearInfo(campYear, firestore)
  // Opening times live on camps/{year} (earlyRegOpenDate for pre-registered
  // families, registrationOpenDate for everyone) and are edited from the
  // admin dashboard. A missing date means "not open".
  const schedule = useCampSchedule(campYear)
  // Display toggles live on camps/{year} too (Camp Year tab); missing = off,
  // which is how both have been set since 2026.
  const showWaitlistHeaderBar =
    schedule.campInfo?.showWaitlistHeaderBar === true
  const showRemainingSpots = schedule.campInfo?.showRemainingSpots === true
  const registrationOpenForPreRegistered = schedule.earlyRegOpen ?? FAR_FUTURE
  const registrationOpen = schedule.registrationOpen ?? FAR_FUTURE
  const [familyData, loading] = useFamilyData({
    isSignedIn: isSignedIn,
    user: user,
    firestore: firestore,
    includeCampers: true,
    includeParents: true,
    includeRegistrations: true,
  })

  // After we've loaded all the data from the server, we can now setup all the data we need for the registration flow.
  // We use a reducer to manage all the various actions we can take on this data.
  const [registrationData, dispatch] = React.useReducer(
    registrationReducer,
    createEmptyRegistrationData(campYear)
  )

  // Parse the data from the server
  const { campers, registrations, campCredit, parents, family } = familyData

  // The family we found may have been created by someone else who listed this
  // parent as a co-parent. Anyone can list any email, so until the parent
  // confirms it is really their household we neither prefill from it nor show
  // its campers, and the server will not register them into it either (it
  // applies the same isEstablishedFamilyMember rule plus `joinFamilyId`).
  const familyNeedsConfirmation =
    family != null && !isEstablishedFamilyMember(family, user.email)
  const useFamily =
    family != null &&
    (!familyNeedsConfirmation || registrationData.joinFamilyId === family.id)

  const thisYearsRegistrations = useFamily
    ? Array.from(registrations.values()).filter(
        (r) => r.campYear === campYear.toString()
      )
    : []
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
  const { reviewStepIndex, titles: checkoutStepTitles } = registrationSteps(
    registrationData.campers.length
  )

  // The step lives here rather than inside CheckoutFlow so a saved session can
  // be restored to the step it was left on. Every change is persisted next to
  // the form data; nothing is written until the family actually navigates, so
  // the step from the previous visit survives until they answer the dialog.
  const [activeStep, setActiveStep] = React.useState(0)
  const handleActiveStepChange = React.useCallback((step: number) => {
    setActiveStep(step)
    saveRegistrationStep(step)
  }, [])

  // "Is this your family?" dialog. Whichever path needed the answer stashes
  // what to do next here, and handleFamilyDecision runs it.
  const [familyDialogOpen, setFamilyDialogOpen] = React.useState(false)
  const afterFamilyDecision = React.useRef<((joined: boolean) => void) | null>(
    null
  )

  // Prefill the signed in parent's info. Only trust the stored parent doc
  // when the family is (or was just confirmed as) theirs; otherwise whoever
  // listed them wrote that doc.
  const prefillSignedInParent = (fromFamily: boolean) => {
    const storedParent = fromFamily
      ? parents.find((p) => p.email === user.email)
      : undefined
    dispatch({
      type: RegistrationActionType.PrefillParent,
      index: 0,
      parent: storedParent ?? { email: user.email, id: user.email, ref: null },
    })
  }

  // Prefill the signed in parent's info and the family info, asking first
  // when the family was created by someone else.
  const prefillFromServer = () => {
    if (familyNeedsConfirmation) {
      afterFamilyDecision.current = (joined) => {
        prefillSignedInParent(joined)
        if (joined && family) {
          dispatch({ type: RegistrationActionType.PrefillFamily, family })
        }
      }
      setFamilyDialogOpen(true)
      return
    }

    prefillSignedInParent(true)
    if (family) {
      dispatch({ type: RegistrationActionType.PrefillFamily, family })
    }
  }

  const handleFamilyDecision = (joined: boolean) => {
    dispatch({
      type: RegistrationActionType.SetJoinFamily,
      joinFamilyId: joined && family ? family.id : null,
    })
    setFamilyDialogOpen(false)
    const next = afterFamilyDecision.current
    afterFamilyDecision.current = null
    next?.(joined)
  }

  const [alertOpen, setAlertOpen] = React.useState(false)
  const [savedSession, setSavedSession] =
    React.useState<SavedRegistrationSession | null>(null)
  const handleNoContinue = () => {
    clearSavedRegistration()
    setAlertOpen(false)
    // With the cache gone, the family-data effect below prefills as soon as
    // the data is in; prefilling now would write a new cache that makes that
    // effect skip the server's parent and family info.
    if (!loading) {
      prefillFromServer()
    }
  }
  const handleYesContinue = () => {
    dispatch({ type: RegistrationActionType.LoadFromCache })
    if (savedSession) {
      // The restored data decides how many steps exist; never jump past its
      // Review step.
      const { reviewStepIndex: restoredReviewStep } = registrationSteps(
        savedSession.data.campers.length
      )
      handleActiveStepChange(Math.min(savedSession.step, restoredReviewStep))
    }
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
      clearSavedRegistration()
      return
    }

    // Parse the current URL to see if there are any query params that we want to apply to the registration form.
    const urlSearchParams = new URLSearchParams(window.location.search)
    if (urlSearchParams.has("success")) {
      if (parseInt(urlSearchParams.get("success"))) {
        // If we succeeded, then we should clear the registration data.
        clearSavedRegistration()
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
      // If success isn't a parameter then this is a new flow. Offer to
      // continue a session that got past the Info step; anything else in the
      // cache (an automatic prefill, an older format) is dropped so the
      // family-data effect prefills from the server as for a first visit.
      const session = readSavedRegistrationSession()
      if (session) {
        setSavedSession(session)
        setAlertOpen(true)
      } else {
        clearSavedRegistration()
      }
    }
    // Mount-only by design: it reads the URL and the cache for the user and
    // camp year the flow was mounted with, and the page remounts the flow on
    // sign-in and on the Test Data toggle. Listing user.email and campYear
    // would re-ask the resume question and reload the cache mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const loadPending = () =>
        dispatch({
          type: RegistrationActionType.LoadPendingPaymentRegistrations,
          campYear: campYear,
          familyData: familyData,
        })

      if (familyNeedsConfirmation) {
        afterFamilyDecision.current = (joined) =>
          joined ? loadPending() : prefillSignedInParent(false)
        setFamilyDialogOpen(true)
      } else {
        loadPending()
      }

      return
    }

    // A cache still present here is a session the family is being asked
    // about, or chose to continue: leave it alone.
    if (window.localStorage.getItem(REGISTRATION_STORAGE_KEY) != null) {
      return
    }

    // Otherwise, prefill the signed in parent's and family's info
    prefillFromServer()
    // Runs once, when the family data first finishes loading. Listing
    // familyData or the prefill helpers would prefill again, over whatever the
    // family has typed, on every later snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  return (
    // Provide the context for the registration data and dispatch. This way we don't need to pass them down through each step.
    <RegistrationDataContext.Provider value={registrationData}>
      <RegistrationDispatchContext.Provider value={dispatch}>
        {showWaitlistHeaderBar && (
          <WaitlistHeaderBar campTracksInfo={campTracksInfo} />
        )}
        <CheckoutFlow
          title=""
          checkoutStepTitles={checkoutStepTitles}
          reviewStepIndex={reviewStepIndex}
          activeStep={activeStep}
          onActiveStepChange={handleActiveStepChange}
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
              key="info"
              campTracksInfo={campTracksInfo}
              campYear={campYear}
              infoSessionDate={schedule.infoSessionDate}
              infoSessionImageUrl={schedule.campInfo?.infoSessionImageUrl}
              showRemainingSpots={showRemainingSpots}
            />,
            <ParentGuardianStep key="parents" />,
            <SelectNumCampersStep
              key="num-campers"
              preRegistrations={preRegistrations}
              campYear={campYear}
            />,
            // Every camper gets a camper and demographic step
            ...registrationData.campers
              .map((camper, index) => [
                <CamperStep
                  key={`camper-${index}`}
                  camper={camper}
                  camperIndex={index}
                  campersInDatabase={useFamily ? campers : []}
                  registrations={thisYearsRegistrations}
                  campYear={campYear}
                />,
                <DemographicsStep
                  key={`demographics-${index}`}
                  demographics={registrationData.demographics[index]}
                  demographicsIndex={index}
                />,
              ])
              .flat(),
            <FamilyCultureStep
              key="family-culture"
              household={registrationData.household}
            />,
            <ReviewStep
              key="review"
              preRegistrations={preRegistrations}
              campCredit={useFamily ? campCredit : 0}
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
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              {savedSession ? `${describeSavedSession(savedSession)} ` : ""}
              Continue picks up on that step with everything you entered;
              starting over discards it.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleNoContinue}>Start over</Button>
            <Button onClick={handleYesContinue} autoFocus>
              Continue
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={familyDialogOpen}
          aria-labelledby="family-dialog-title"
          aria-describedby="family-dialog-description"
        >
          <DialogTitle id="family-dialog-title">
            Is this your family?
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="family-dialog-description">
              {family?.createdBy ?? "Another parent"} listed {user.email} as a
              parent or guardian on an existing family
              {family?.city
                ? ` in ${family.city}${family.state ? `, ${family.state}` : ""}`
                : ""}
              . If that is your household, continue with it to see its campers
              and registrations. If you don&apos;t recognize it, start your own
              family instead and nothing from it will be shared with you.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => handleFamilyDecision(false)}>
              Not my family
            </Button>
            <Button onClick={() => handleFamilyDecision(true)} autoFocus>
              Yes, continue with it
            </Button>
          </DialogActions>
        </Dialog>
      </RegistrationDispatchContext.Provider>
    </RegistrationDataContext.Provider>
  )
}
