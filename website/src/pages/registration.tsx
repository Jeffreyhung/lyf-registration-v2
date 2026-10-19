import React from "react"
import { PageProps } from "gatsby"
import { Stack, Typography } from "@mui/material"

// Utils
import getPageTitle from "@utils/getPageTitle"

// Components
import PrivateRoute from "@components/Auth/PrivateRoute"
import { SnackbarAlertProvider } from "@components/SnackbarAlert"
import { ScheduleGated } from "@components/Layout"
import { LinkButton } from "@components/Button"
import { RegistrationFlow } from "@components/Registration"

// Hooks
import useSiteConfig from "@hooks/useSiteConfig"
import useCampSchedule from "@hooks/useCampSchedule"

// Which year this page registers for, when it closes, and who may bypass the
// close all come from Firestore (config/site -> camps/{year}) and are edited
// from the admin dashboard's Camp Year tab.
const RegistrationPage: React.FC<PageProps> = () => {
  const { currentCampYear, loading: configLoading } = useSiteConfig()
  const schedule = useCampSchedule(currentCampYear)
  const loading =
    configLoading || (currentCampYear !== null && schedule.loading)

  return (
    <ScheduleGated
      loading={loading}
      hideAfterDateTime={schedule.registrationClose}
      allowEmails={schedule.bypassEmails}
      contentIfHidden={
        <Stack
          justifyContent="center"
          alignItems="center"
          spacing={2}
          sx={{ padding: 2 }}
        >
          <Typography variant="h3" textAlign="center">
            Registration for LYF Camp {currentCampYear} is now closed!
          </Typography>
          <LinkButton to="/" variant="contained">
            Return to Home Page
          </LinkButton>
        </Stack>
      }
    >
      <SnackbarAlertProvider>
        <PrivateRoute>
          {/* Used as a separate component to reduce the number of renders from not logged in */}
          <RegistrationFlow campYear={currentCampYear as number} />
        </PrivateRoute>
      </SnackbarAlertProvider>
    </ScheduleGated>
  )
}

export default RegistrationPage

export const Head = getPageTitle("Registration")
