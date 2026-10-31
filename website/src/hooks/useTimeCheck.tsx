import React, { useState } from "react"
import dayjs, { Dayjs } from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat"
import { getServerNow } from "@utils/serverTime"

type UseTimeCheckProps = {
  isAdmin: boolean
  isEarlyAccess: boolean
  earlyAccessTimeAfterValid: Dayjs
  timeAfterValid: Dayjs
}

dayjs.extend(customParseFormat)

export default function useTimeCheck({
  isAdmin,
  isEarlyAccess,
  earlyAccessTimeAfterValid,
  timeAfterValid,
}: UseTimeCheckProps): boolean {
  const [date, setDate] = useState<Dayjs>(null)

  // Run the check against the (session-cached) server date once. The hooks
  // run on every render, admin or not: admin status resolves asynchronously
  // after sign-in, and returning before them once it flips would change the
  // hook order between renders.
  React.useEffect(() => {
    let cancelled = false
    getServerNow()
      .then((serverDate) => {
        if (!cancelled) setDate(dayjs(serverDate))
      })
      .catch(() => {
        if (!cancelled) setDate(dayjs())
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (isAdmin) {
    return true
  }

  return (
    date &&
    date.isAfter(isEarlyAccess ? earlyAccessTimeAfterValid : timeAfterValid)
  )
}
