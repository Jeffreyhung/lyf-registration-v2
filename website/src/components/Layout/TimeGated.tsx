import React from "react"
import dayjs, { Dayjs } from "dayjs"
import { getServerDate } from "@nodeguy/server-date"
import { Grid, CircularProgress } from "@mui/material"

import AuthContext from "@components/Auth/AuthContext"

type TimeGatedProps = React.PropsWithChildren<{
  hideAfterDateTime: Dayjs
  contentIfHidden: React.ReactNode
  forceHide?: boolean
  allowAdmin?: boolean
  allowEmails?: string[]
  /** Caller already established that this viewer may pass (e.g. useRegistrationBypass). */
  allowBypass?: boolean
}>

// Because this time can be duped by changing the computer's system clock,
// we need to make sure that we have a "forceHide" option that we eventually
// switch over to later.
export default function TimeGated({
  hideAfterDateTime,
  contentIfHidden,
  forceHide = false,
  allowAdmin = false,
  allowEmails = [],
  allowBypass = false,
  children,
}: TimeGatedProps) {
  const { isAdmin, user } = React.useContext(AuthContext)
  const userEmailLower = user?.email?.toLowerCase() ?? ""
  const shouldBypassTimeGate =
    allowBypass ||
    (allowAdmin && isAdmin) ||
    allowEmails.some((e) => e.toLowerCase() === userEmailLower)
  const [isHidden, setIsHidden] = React.useState(
    forceHide && shouldBypassTimeGate
  )
  const [isLoading, setIsLoading] = React.useState(true)
  React.useEffect(() => {
    const checkTime = async () => {
      const { date } = await getServerDate()

      if (!forceHide && typeof window !== "undefined") {
        setIsHidden(
          !shouldBypassTimeGate && dayjs(date).isAfter(hideAfterDateTime)
        )
      }

      setIsLoading(false)
    }
    checkTime()
    // Re-evaluate when the bypass decision arrives after sign-in.
  }, [forceHide, hideAfterDateTime, shouldBypassTimeGate])

  return (
    <>
      {isLoading ? (
        <Grid container justifyContent="center">
          <CircularProgress />
        </Grid>
      ) : isHidden ? (
        contentIfHidden
      ) : (
        children
      )}
      {}
    </>
  )
}
