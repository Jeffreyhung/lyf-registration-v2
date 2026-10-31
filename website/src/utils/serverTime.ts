import { getServerDate } from "@nodeguy/server-date"

/**
 * getServerDate() estimates the gap between the visitor's clock and the
 * server's by issuing ten sequential HEAD requests to the current page. The
 * gap does not change within a page session, so it is sampled once per
 * session here and every time gate derives "now" from the cached offset
 * instead of running its own ten-request round.
 */
let offsetPromise: Promise<number> | null = null

export const getServerOffset = (): Promise<number> => {
  if (!offsetPromise) {
    offsetPromise = getServerDate().then(({ offset }) => {
      // Every sample failed (offline, blocked HEAD): nothing usable came back.
      if (typeof offset !== "number" || Number.isNaN(offset)) {
        throw new Error("No usable server date sample")
      }
      return offset
    })
    // A failed round is not cached, so the next caller samples again.
    offsetPromise.catch(() => {
      offsetPromise = null
    })
  }
  return offsetPromise
}

/** The current time according to the server. Rejects if it cannot be known. */
export const getServerNow = async (): Promise<Date> =>
  new Date(Date.now() + (await getServerOffset()))
