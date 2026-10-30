// Created by Josh W Comeau: https://www.joshwcomeau.com/snippets/react-hooks/use-random-interval/
import { useRef, useEffect, useCallback } from "react"
import random from "@utils/random"

export default function useRandomInterval(
  callback: React.EffectCallback,
  minDelay: number | null,
  maxDelay: number | null
) {
  const timeoutId = useRef<number>(0)
  const savedCallback = useRef(callback)
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])
  useEffect(() => {
    const isEnabled =
      typeof minDelay === "number" && typeof maxDelay === "number"
    if (isEnabled) {
      const handleTick = () => {
        const nextTickAt = random(minDelay as number, maxDelay as number)
        timeoutId.current = window.setTimeout(() => {
          savedCallback.current()
          handleTick()
        }, nextTickAt)
      }
      handleTick()
    }
    return () => window.clearTimeout(timeoutId.current)
  }, [minDelay, maxDelay])
  const cancel = useCallback(function () {
    window.clearTimeout(timeoutId.current)
  }, [])
  return cancel
}
