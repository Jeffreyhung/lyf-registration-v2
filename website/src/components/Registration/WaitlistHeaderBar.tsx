import React from "react"
import { AppBar, Toolbar, Typography, Container } from "@mui/material"

import { CampTrackInfo } from "lyf-registration-schemas"

type WaitlistHeaderBarProps = {
  campTracksInfo: CampTrackInfo[]
}

export default function WaitlistHeaderBar({
  campTracksInfo,
}: WaitlistHeaderBarProps) {
  const fullCampTracks = campTracksInfo
    .filter(({ remainingSpots }) => remainingSpots <= 0)
    .map(({ track }) => track)

  // No full tracks so don't show anything
  if (fullCampTracks.length <= 0) {
    return <></>
  }

  const fullCampTrackNames =
    fullCampTracks.length <= 2
      ? fullCampTracks.join(" and ")
      : `${fullCampTracks.slice(0, -1).join(", ")}, and ${fullCampTracks.at(
          -1
        )}`

  const isPlural = fullCampTracks.length > 1

  return (
    <AppBar position="static" color="secondary">
      <Toolbar variant="dense">
        <Container maxWidth="md">
          <Typography variant="h6" textAlign="center">
            {fullCampTrackNames} camp {isPlural ? "tracks are" : "track is"}{" "}
            full! Register to join our waitlist
          </Typography>
        </Container>
      </Toolbar>
    </AppBar>
  )
}
