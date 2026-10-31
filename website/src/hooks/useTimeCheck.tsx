import React, { useState } from "react"
import { getServerDate } from "@nodeguy/server-date"
import dayjs, { Dayjs } from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat"

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

  // Check the server date once. Admins skip the gate, but the effect has to
  // be registered on every render (rules of hooks).
  React.useEffect(() => {
    if (isAdmin) return
    async function checkDate() {
      const { date } = await getServerDate()
      setDate(dayjs(date))
    }

    checkDate()
  }, [isAdmin])

  if (isAdmin) {
    return true
  }

  return (
    date &&
    date.isAfter(isEarlyAccess ? earlyAccessTimeAfterValid : timeAfterValid)
  )
}
