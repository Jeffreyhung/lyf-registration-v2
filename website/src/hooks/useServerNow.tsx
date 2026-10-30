import React from "react"
import dayjs, { Dayjs } from "dayjs"
import { getServerNow } from "@utils/serverTime"

/**
 * The current time according to the server, fetched once on mount. Null
 * until it arrives. Used wherever a decision depends on "now" so a visitor
 * cannot move their system clock to get around a window.
 */
export default function useServerNow(): Dayjs | null {
  const [now, setNow] = React.useState<Dayjs | null>(null)
  React.useEffect(() => {
    let cancelled = false
    getServerNow()
      .then((date) => {
        if (!cancelled) setNow(dayjs(date))
      })
      .catch(() => {
        // Fall back to the local clock rather than leaving the page blank.
        if (!cancelled) setNow(dayjs())
      })
    return () => {
      cancelled = true
    }
  }, [])
  return now
}
