import React from "react"
import { PageProps } from "gatsby"
import { Stack, Typography } from "@mui/material"

// Utils
import getPageTitle from "@utils/getPageTitle"
import { formatCampDate } from "@utils/campTime"

// Components
import PrivateRoute from "@components/Auth/PrivateRoute"
import { SnackbarAlertProvider } from "@components/SnackbarAlert"
import CamperCheckoutFlow from "@components/CamperCheckoutFlow"
import { ScheduleGated } from "@components/Layout"
import { UnavailableMessage } from "@components/Layout/ScheduleGated"
import { LinkButton } from "@components/Button"

// Hooks
import useSiteConfig from "@hooks/useSiteConfig"
import useCampSchedule from "@hooks/useCampSchedule"

// The year being pre-registered for and its window come from Firestore
// (config/site.preRegistrationCampYear -> camps/{year}.preRegistration*Date)
// and are edited from the admin dashboard's Camp Year tab.
const PreRegistrationPage: React.FC<PageProps> = () => {
  const { preRegistrationCampYear, loading: configLoading } = useSiteConfig()
  const schedule = useCampSchedule(preRegistrationCampYear)
  const loading =
    configLoading || (preRegistrationCampYear !== null && schedule.loading)

  const { earlyRegOpen, registrationOpen } = schedule
  const nextSteps =
    earlyRegOpen && registrationOpen
      ? `Registration will open on ${formatCampDate(earlyRegOpen)} for ` +
        `pre-registered campers and on ${formatCampDate(registrationOpen)} for everyone else`
      : registrationOpen
      ? `General registration will open on ${formatCampDate(registrationOpen)}`
      : null

  return (
    <ScheduleGated
      loading={loading}
      hideAfterDateTime={schedule.preRegistrationClose}
      contentIfUnavailable={<UnavailableMessage what="Pre-Registration" />}
      contentIfHidden={
        <Stack
          justifyContent="center"
          alignItems="center"
          spacing={2}
          sx={{ padding: 2 }}
        >
          <Typography variant="h3" textAlign="center">
            Pre-Registration for LYF Camp {preRegistrationCampYear} is now
            closed!
          </Typography>
          {nextSteps && (
            <Typography variant="h4" textAlign="center">
              {nextSteps}
            </Typography>
          )}
          <LinkButton to="/" variant="contained">
            Return to Home Page
          </LinkButton>
        </Stack>
      }
    >
      <SnackbarAlertProvider>
        <PrivateRoute>
          {/* Used as a separate component to reduce the number of renders from not logged in */}
          {/* CamperCheckoutFlow takes the year the camper *attended* and pre-registers them
              for the following one, so the attended year is the pre-registration year minus one. */}
          <CamperCheckoutFlow
            campYear={(preRegistrationCampYear as number) - 1}
            hideCamperCheckout={true}
          />
        </PrivateRoute>
      </SnackbarAlertProvider>
    </ScheduleGated>
  )
}

export default PreRegistrationPage

export const Head = getPageTitle("Pre-Registration")
