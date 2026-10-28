import React from "react"
import { Dayjs } from "dayjs"
import { Box, Divider, Link, Stack, Typography } from "@mui/material"

import RegistrationStep from "./RegistrationStep"
import { CampTrackInfo } from "lyf-registration-schemas"
import { StaticImage } from "gatsby-plugin-image"
import { formatCampDateWithYear } from "@utils/campTime"

type InfoStepProps = {
  campTracksInfo: CampTrackInfo[]
  campYear: number
  /** camps/{year}.infoSessionDate; the sentence is omitted when unset. */
  infoSessionDate: Dayjs | null
}

/// Changed in 2026 to hide remaing spots per camp track
const SHOW_REMAINING_SPOTS = false

// TODO: Move this into a CMS to better manage support
// The VIS banner image and the long notice copy below are still edited by
// hand each year; the year and info-session date come from Firestore.
export default function InfoStep({
  campTracksInfo,
  campYear,
  infoSessionDate,
}: InfoStepProps) {
  return (
    <RegistrationStep
      primaryButtonText="Next"
      sidebarContent={
        <Box
          sx={{
            borderColor: "primary.main",
            borderStyle: "solid",
            borderWidth: 4,
            marginLeft: 2,
            marginRight: 2,
            borderRadius: 5,
            width: 1,
          }}
        >
          <StaticImage
            src="../../images/vis_2026.jpg"
            alt="LYF Virtual Info Session banner"
            formats={["webp"]}
            style={{
              borderRadius: "16px",
            }}
          />
        </Box>
      }
    >
      <Stack
        gap={1}
        maxWidth="lg"
        sx={{
          padding: { xs: 0, sm: 2 },
        }}
      >
        <Typography variant="h4" sx={{ paddingBottom: 1 }}>
          Important notice for TACL-LYF Camp {campYear}!
        </Typography>
        <Typography variant="body1">
          TACL-LYF Camp will be split into two age-specific tracks: younger
          campers (rising 5th-8th grade campers) and older campers (rising 9th
          grade and older). This will allow us to better tailor our programming
          and activities towards specific age groups, as well as help us manage
          our growing camp. Here's what you need to know:
        </Typography>

        <ul>
          <li>
            Camp will be split evenly into a younger (rising 5th-8th grade
            campers) and older track (rising 9th grade + older). Registration
            for each track will be capped at a certain number, and will be
            conducted on a first-come first serve basis
          </li>
          <li>
            We will prioritize siblings and relatives when moving campers off
            the waitlists, to minimize accepting only one camper from a family
            or group of relatives
            <ul>
              <li>
                Please let us know if you are registering with relatives by
                leaving a comment in the “Additional Notes” section of the
                registration process
              </li>
            </ul>
          </li>
          <li>
            Location and dates of of camp, logistics (e.g. drop-off, pick-up),
            and registration policies will be the same for all campers
          </li>
          <li>
            Campers from each track will still be able to interact with each
            other during meal-times, camp-wide activities, and cabin time
          </li>
        </ul>

        <Typography variant="body1">
          Please contact us with any questions or concerns at{" "}
          <Link href="mailto:lyf@tacl.org">lyf@tacl.org</Link>.
          {infoSessionDate && (
            <>
              {" "}
              We will also be hosting a{" "}
              <Link href="https://luma.com/3i4afmyf">
                Virtual Parent Info Session
              </Link>{" "}
              on {formatCampDateWithYear(infoSessionDate)}, where we will be
              going over camp in more detail.
            </>
          )}
        </Typography>

        <Divider
          sx={{
            marginTop: 1,
            marginBottom: 1,
          }}
        />
        {SHOW_REMAINING_SPOTS &&
          campTracksInfo.map(({ track, remainingSpots }) => (
            <Typography key={track}>
              <b>{track} Camp Track</b>: {remainingSpots} spots remaining
            </Typography>
          ))}
      </Stack>
    </RegistrationStep>
  )
}
