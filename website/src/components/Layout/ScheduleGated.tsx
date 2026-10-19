import React from "react"
import { Dayjs } from "dayjs"
import { CircularProgress, Grid, Stack, Typography } from "@mui/material"

import { LinkButton } from "@components/Button"
import TimeGated from "./TimeGated"

type ScheduleGatedProps = React.PropsWithChildren<{
  /** True while config/site or camps/{year} is still loading. */
  loading: boolean
  /**
   * When the gate closes. Null means the schedule could not be resolved
   * (missing config/site, missing camp document, or the date is not set) and
   * the gate is treated as closed.
   */
  hideAfterDateTime: Dayjs | null
  /** Shown once the close date has passed. */
  contentIfHidden: React.ReactNode
  /** Shown when the schedule is unavailable; a plain default is provided. */
  contentIfUnavailable?: React.ReactNode
  allowEmails?: string[]
  allowAdmin?: boolean
}>

export function Spinner() {
  return (
    <Grid container justifyContent="center" sx={{ padding: 4 }}>
      <CircularProgress />
    </Grid>
  )
}

export function UnavailableMessage({ what }: { what: string }) {
  return (
    <Stack justifyContent="center" alignItems="center" spacing={2} sx={{ padding: 2 }}>
      <Typography variant="h3" textAlign="center">
        {what} is not available right now
      </Typography>
      <Typography variant="h5" textAlign="center">
        Please check back later or contact us at lyf@tacl.org.
      </Typography>
      <LinkButton to="/" variant="contained">
        Return to Home Page
      </LinkButton>
    </Stack>
  )
}

/**
 * TimeGated driven by dates loaded from Firestore. Shows the spinner until
 * the schedule is known, then hands off to TimeGated with the real close
 * time. If the schedule cannot be resolved the gate fails closed.
 */
export default function ScheduleGated({
  loading,
  hideAfterDateTime,
  contentIfHidden,
  contentIfUnavailable = <UnavailableMessage what="Registration" />,
  allowEmails,
  allowAdmin,
  children,
}: ScheduleGatedProps) {
  if (loading) return <Spinner />
  if (!hideAfterDateTime) return <>{contentIfUnavailable}</>
  return (
    <TimeGated
      hideAfterDateTime={hideAfterDateTime}
      contentIfHidden={contentIfHidden}
      allowEmails={allowEmails}
      allowAdmin={allowAdmin}
    >
      {children}
    </TimeGated>
  )
}
