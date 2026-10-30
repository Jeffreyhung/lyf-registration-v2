import React from "react"
import type { PageProps } from "gatsby"
import {
  CardContent,
  Container,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material"
import {
  CalendarMonthOutlined,
  ChevronRight,
  EmailOutlined,
  PersonOutlined,
  PlaceOutlined,
} from "@mui/icons-material"

// Utils
import getPageTitle from "@utils/getPageTitle"

// Components
import { MainHeaderCardWithShadow } from "@components/Card"
import { TriangleBorder } from "@components/FullScreenDesign"
import { AnimatedLinkButton } from "@components/Button"

// Hooks
import useSiteConfig from "@hooks/useSiteConfig"
import useCampSchedule from "@hooks/useCampSchedule"
import useServerNow from "@hooks/useServerNow"
import { CAMP_TIME_ZONE } from "@utils/campTime"

// Shown until camps/{year} supplies real values.
const FALLBACK_CAMP_DATES = "Dates to be announced"
const FALLBACK_CAMPSITE = "Alliance Redwoods Conference Grounds"
const FALLBACK_CAMPSITE_ADDRESS = "6250 Bohemian Hwy, Occidental, CA 95465"

const IndexPage: React.FC<PageProps> = () => {

  // The home page points at whichever flow is open right now: registration
  // for the current camp year, or pre-registration for the next one once
  // registration has closed and the pre-registration window is open.
  const { currentCampYear, preRegistrationCampYear } = useSiteConfig()
  const current = useCampSchedule(currentCampYear)
  const preReg = useCampSchedule(preRegistrationCampYear)
  const now = useServerNow()

  const registrationStillOpen =
    !!now && !!current.registrationClose && now.isBefore(current.registrationClose)
  const preRegistrationOpen =
    !!now &&
    !!preReg.preRegistrationOpen &&
    !!preReg.preRegistrationClose &&
    now.isAfter(preReg.preRegistrationOpen) &&
    now.isBefore(preReg.preRegistrationClose)
  const showPreRegistration = preRegistrationOpen && !registrationStillOpen

  const heroYear = showPreRegistration ? preRegistrationCampYear : currentCampYear
  const heroVerb = showPreRegistration ? "Pre-Register" : "Register"
  const ctaTo = showPreRegistration ? "/preregistration" : "/registration"
  const ctaLabel = showPreRegistration
    ? "Continue to Pre-Registration"
    : "Continue to Registration"

  const campDates =
    current.campStart && current.campEnd
      ? `${current.campStart.tz(CAMP_TIME_ZONE).format("dddd, MMMM D")} - ` +
        `${current.campEnd.tz(CAMP_TIME_ZONE).format("dddd, MMMM D")}`
      : FALLBACK_CAMP_DATES
  const nights =
    current.campStart && current.campEnd
      ? current.campEnd.startOf("day").diff(current.campStart.startOf("day"), "day")
      : null
  const campDuration = nights ? `${nights + 1} days, ${nights} nights` : undefined
  const campsite = current.campInfo?.campsite || FALLBACK_CAMPSITE
  const campsiteAddress =
    current.campInfo?.campsiteAddress || FALLBACK_CAMPSITE_ADDRESS

  return (
    <Stack alignItems="center" spacing={2}>
      <TriangleBorder />

      <Container
        maxWidth="lg"
        sx={{
          paddingTop: 4,
          paddingLeft: 1,
          paddingRight: 1,
          paddingBottom: 4,
        }}
      >
        <Typography variant="h3" textAlign="center">
          {heroVerb} for TACL-LYF Camp{heroYear ? ` ${heroYear}` : ""}!
        </Typography>
      </Container>

      <AnimatedLinkButton
        to={ctaTo}
        boopProps={{
          x: 3,
          scale: 1.01,
        }}
        endIcon={<ChevronRight />}
        color="secondary"
        variant="contained"
      >
        {ctaLabel}
      </AnimatedLinkButton>

      {/* Main Content */}
      <Grid container sx={{ padding: 2 }} spacing={3} alignItems="stretch">
        {/* First Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <MainHeaderCardWithShadow
            title={`${currentCampYear ?? ""} Camp Details`.trim()}
            mainColor="secondary"
          >
            <CardContent
              sx={{
                paddingTop: 1,
                paddingBottom: 1,
                paddingLeft: 3,
                paddingRight: 3,
              }}
            >
              <Stack spacing={1}>
                <List>
                  <ListItem disablePadding>
                    <ListItemIcon>
                      <CalendarMonthOutlined fontSize="large" />
                    </ListItemIcon>
                    <ListItemText primary={campDates} secondary={campDuration} />
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemIcon>
                      <PlaceOutlined fontSize="large" />
                    </ListItemIcon>
                    <ListItemText primary={campsite} secondary={campsiteAddress} />
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemIcon>
                      <PersonOutlined fontSize="large" />
                    </ListItemIcon>
                    <ListItemText primary="4th - 12th graders" />
                  </ListItem>
                </List>

                <Typography variant="h6">
                  For more information, visit our website{" "}
                  <a href="https://lyf.tacl.org">lyf.tacl.org</a>
                </Typography>
                <Typography color="secondary" variant="body1">
                  <a href="https://lyf.tacl.org/camp/registration-policy/">
                    Details on our registration/cancellation policy
                  </a>
                </Typography>
              </Stack>
            </CardContent>
          </MainHeaderCardWithShadow>
        </Grid>

        {/* Second Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <MainHeaderCardWithShadow
            title="Mission Statement"
            mainColor="primary"
          >
            <Stack sx={{ padding: 3 }} justifyContent="center">
              <Typography variant="h6" textAlign="center">
                Become whole person leaders through an understanding of
                heritage, self, and the world.
              </Typography>
            </Stack>
          </MainHeaderCardWithShadow>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <MainHeaderCardWithShadow title="Contact Us" mainColor="tertiary">
            <Stack sx={{ padding: 3 }} spacing={1} justifyContent="center">
              <Typography variant="h6">
                Questions about registration? Feel free to reach our team at
              </Typography>

              <ListItem disablePadding>
                <ListItemIcon>
                  <EmailOutlined fontSize="large" />
                </ListItemIcon>
                <ListItemText primary="lyf@tacl.org" />
              </ListItem>
            </Stack>
          </MainHeaderCardWithShadow>
        </Grid>
      </Grid>
    </Stack>
  )
}

export default IndexPage

export const Head = getPageTitle("Registration")
