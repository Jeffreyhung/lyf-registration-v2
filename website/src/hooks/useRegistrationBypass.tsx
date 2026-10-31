import React from "react"
import { doc, getDoc } from "firebase/firestore"

import {
  normalizeEmail,
  registrationBypassDocPath,
} from "lyf-registration-schemas"
import AuthContext from "@components/Auth/AuthContext"
import ProdContext from "@components/ProdContext"

export type RegistrationBypassState = {
  /** True when the signed-in user has a bypass entry for this year. */
  canBypass: boolean
  /** True while the lookup is in flight (always false when signed out). */
  loading: boolean
}

/**
 * Whether the signed-in user may use the registration page after it closes.
 * Reads camps/{year}/private/bypass/emails/{email}: Firestore rules let a
 * parent read only their own entry, so this reveals nothing about anyone
 * else, and a missing or denied document simply means "no bypass".
 */
export default function useRegistrationBypass(
  year: number | null | undefined
): RegistrationBypassState {
  const { firestore } = React.useContext(ProdContext)
  const { user } = React.useContext(AuthContext)
  const email = user?.email ? normalizeEmail(user.email) : null

  const [state, setState] = React.useState<RegistrationBypassState>({
    canBypass: false,
    loading: false,
  })

  React.useEffect(() => {
    if (typeof year !== "number" || !email || !firestore) {
      setState({ canBypass: false, loading: false })
      return undefined
    }
    let cancelled = false
    setState({ canBypass: false, loading: true })
    getDoc(doc(firestore, registrationBypassDocPath(year, email)))
      .then((snap) => {
        if (!cancelled) setState({ canBypass: snap.exists(), loading: false })
      })
      .catch(() => {
        // permission-denied == not on the list
        if (!cancelled) setState({ canBypass: false, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [firestore, year, email])

  return state
}
