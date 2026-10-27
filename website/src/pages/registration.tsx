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
import useRegistrationBypass from "@hooks/useRegistrationBypass"

// Which year this page registers for and when it closes come from Firestore
// (config/site -> camps/{year}, public). Whether the signed-in family may
// register after the close is a private per-email document that only they
// and admins can read. All of it is edited from the Camp Year tab.
const RegistrationPage: React.FC<PageProps> = () => {
  const { currentCampYear, loading: configLoading } = useSiteConfig()
  const schedule = useCampSchedule(currentCampYear)
  const bypass = useRegistrationBypass(currentCampYear)
  const loading =
    configLoading ||
    (currentCampYear !== null && (schedule.loading || bypass.loading))

  return (
    <ScheduleGated
      loading={loading}
      hideAfterDateTime={schedule.registrationClose}
      allowBypass={bypass.canBypass}
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
