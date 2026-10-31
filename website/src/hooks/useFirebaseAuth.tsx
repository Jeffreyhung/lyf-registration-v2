import * as React from "react"

import { firebaseAuth, firestore } from "@utils/firebaseApp"
import {
  User,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import {
  AdminRole,
  normalizeEmail,
  resolveAdminRole,
} from "lyf-registration-schemas"

export type FirebaseAuthContext = {
  isSignedIn: boolean
  user: User | null
  isAdmin: boolean
  adminRole: AdminRole | null
  isAuthLoading: boolean
}

type AdminCheck = { isAdmin: boolean; role: AdminRole | null }

async function checkAdminStatus(email: string | null): Promise<AdminCheck> {
  if (!email) return { isAdmin: false, role: null }
  try {
    const adminDoc = await getDoc(doc(firestore, "admins", normalizeEmail(email)))
    if (!adminDoc.exists() || adminDoc.data()?.disabled === true) {
      return { isAdmin: false, role: null }
    }
    // Fail closed: a missing or unrecognized role value grants nothing.
    const role = resolveAdminRole(adminDoc.data()?.role)
    return { isAdmin: role !== null, role }
  } catch (err) {
    // Still fail closed, but never silently: a transport or rules failure here
    // is indistinguishable from "not an admin" in the UI otherwise.
    console.error("[auth] admin role lookup failed; treating as non-admin", err)
    return { isAdmin: false, role: null }
  }
}

export default function useFirebaseAuth(): FirebaseAuthContext {
  const [isSignedIn, setIsSignedIn] = React.useState(false)
  const [user, setUser] = React.useState<User | null>(null)
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [adminRole, setAdminRole] = React.useState<AdminRole | null>(null)
  const [isAuthLoading, setIsAuthLoading] = React.useState(false)

  React.useEffect(() => {
    let email = window.localStorage.getItem("emailForSignIn")
    if (!isSignedIn && isSignInWithEmailLink(firebaseAuth, window.location.href)) {
      setIsAuthLoading(true)
      if (!email) {
        email = window.prompt("Please provide your email for confirmation")
      }

      signInWithEmailLink(firebaseAuth, email as string, window.location.href)
        .then((credential) => {
          setIsSignedIn(!!credential)
          setUser(credential.user)
          setIsAdmin(false)
          setAdminRole(null)
          checkAdminStatus(credential.user.email).then(({ isAdmin, role }) => {
            setIsAdmin(isAdmin)
            setAdminRole(role)
          })
        }).catch((e) => console.error("Email link sign-in failed", e))
        .finally(() => setIsAuthLoading(false))
    }

    const unregisterAuthObserver = firebaseAuth.onAuthStateChanged((user) => {
      setIsSignedIn(!!user)
      setUser(user)
      setIsAdmin(false)
      setAdminRole(null)
      checkAdminStatus(user?.email ?? null).then(({ isAdmin, role }) => {
        setIsAdmin(isAdmin)
        setAdminRole(role)
      })
    })
    return () => unregisterAuthObserver()
  }, [])

  return { isSignedIn, user, isAdmin, adminRole, isAuthLoading }
}
