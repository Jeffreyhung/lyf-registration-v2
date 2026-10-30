import React from "react"
import {
  Button,
  Stack,
  TextField,
  Typography,
  CircularProgress,
  Divider,
  Container,
} from "@mui/material"
import {
  sendSignInLinkToEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth"
import { animated as a, useTransition } from "@react-spring/web"

// Utils
import { firebaseAuth } from "@utils/firebaseApp"
import { SnackbarAlertContext } from "@components/SnackbarAlert"

// Components
import { FirebaseError } from "firebase/app"
import { GradientTypography } from "@components/Typography"
import { GoogleLogo } from "@components/Logo"

type LoginFlowProps = {}

/*** React Effect that listens for the auth event on redirects occurs in the useAuth hook  ***/
export default function LoginFlow({}: LoginFlowProps) {
  const redirectUrl =
    typeof window !== `undefined`
      ? `${window.location.origin}${window.location.pathname}`
      : ""
  const [error, setError] = React.useState<string | null>(null)
  const { setSnackbar } = React.useContext(SnackbarAlertContext)

  /*** Email Link Sign-In ***/
  const [email, setEmail] = React.useState<string>("")
  const [submitted, setSubmitted] = React.useState(false)
  const [loading, setIsLoading] = React.useState(false)

  const handleEmailChange: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => setEmail(event.target.value)

  const handleEmailLinkSignIn = async () => {
    setIsLoading(true)

    try {
      const parsedEmail = email.toLowerCase().trim()
      await sendSignInLinkToEmail(firebaseAuth, parsedEmail, {
        // URL must be in authorized domains list in Firebase Console.
        url: redirectUrl,
        handleCodeInApp: true,
      })

      // Success
      setIsLoading(false)
      setSubmitted(true)
      setSnackbar({
        children: `Sent email link to ${parsedEmail}`,
        severity: "success",
      })

      // Save the email locally so we don't need to ask the user for it again if they open
      // the link on the same device. See useFirebaseAuth for where it's used.
      window.localStorage.setItem("emailForSignIn", parsedEmail)
    } catch (error) {
      setError((error as FirebaseError).message)
      setSnackbar({
        children: `Failed to send email link`,
        severity: "error",
      })
      setIsLoading(false)
    }
  }

  /*** Google Sign-In ***/
  const googleProvider = new GoogleAuthProvider()
  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(firebaseAuth, googleProvider)
    } catch (error) {
      const code = (error as FirebaseError).code
      // The user closed the popup, or clicked the button again before the
      // first popup finished. Neither is a failure worth reporting.
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        return
      }
      setSnackbar({
        children:
          code === "auth/popup-blocked"
            ? "Your browser blocked the sign-in popup. Allow popups for this site and try again, or sign in with an email link instead."
            : "Failed to sign in with Google. Please try again or sign in with an email link instead.",
        severity: "error",
      })
    }
  }

  /*** Submitted and Sign In Flow ***/
  const SubmittedFlow = (
    <Stack
      justifyContent="center"
      alignItems="stretch"
      spacing={2}
      sx={{
        height: "70vh",
        padding: 1,
      }}
    >
      <Typography variant="h2" textAlign="center" color="primary">
        Check your email!
      </Typography>
      <Typography variant="h6" textAlign="center">
        You just received a "magic link" to sign you in. It should show up in
        your inbox in 30 seconds or so.
      </Typography>
      <Typography variant="body1" textAlign="center">
        <i>
          If you don't see an email, please check your "promotions" or "spam"
          folders.
        </i>
      </Typography>
      <Button
        disabled={loading}
        startIcon={loading && <CircularProgress size={25} />}
        onClick={handleEmailLinkSignIn}
        color="secondary"
        sx={{
          margin: 1,
        }}
      >
        I did not receive a link
      </Button>
    </Stack>
  )

  const SignInFlow = (
    <Stack
      justifyContent="center"
      alignItems="stretch"
      spacing={2}
      sx={{
        padding: 1,
        paddingTop: {
          xs: 1,
          lg: 4,
        },
      }}
      component={Container}
      maxWidth="md"
    >
      <Stack padding={4} spacing={1}>
        <GradientTypography variant="h2" textAlign="center">
          Sign in to access this page
        </GradientTypography>
        <Typography variant="h6" textAlign="center">
          Please sign in using the same email used for registration.
        </Typography>
        <Typography variant="body1" textAlign="center">
          If you do not have access to this email right now, please email
          lyf@tacl.org for assistance.
        </Typography>
      </Stack>

      {/* Email Link Login */}
      <Stack
        alignItems="stretch"
        justifyContent="center"
        spacing={2}
        padding={1}
      >
        <Typography variant="h5" textAlign="center">
          Sign in with a password-less email link
        </Typography>
        <TextField
          id="email-link-email-field"
          label="Email"
          variant="outlined"
          onChange={handleEmailChange}
          onKeyUp={(event) => {
            if (event.key === "Enter") {
              handleEmailLinkSignIn()
            }
          }}
        />
        <Button
          disabled={!email || loading}
          startIcon={loading && <CircularProgress size={25} />}
          onClick={handleEmailLinkSignIn}
        >
          Sign In
        </Button>
        {error && (
          <Typography variant="h6" textAlign="center">
            {error}
          </Typography>
        )}
      </Stack>

      <Divider role="presentation">
        <Typography variant="h6">Or, use a provider</Typography>
      </Divider>

      {/* Google Login */}
      <Button
        onClick={handleGoogleSignIn}
        startIcon={<GoogleLogo />}
        size="large"
      >
        Sign in with Google
      </Button>
    </Stack>
  )

  // Transition between the flows
  const transitions = useTransition(submitted, {
    keys: null,
    from: { opacity: 0, transform: `translate3d(0,15%,0)` },
    enter: { opacity: 1, transform: `translate3d(0,0,0)` },
    leave: { opacity: 0, transform: `translate3d(0,-10%,0)` },
    exitBeforeEnter: true,
    config: {
      tension: 200,
      clamp: true,
    },
  })

  // If we've submitted an email link, then inform the user to check their email. Otherwise, display the sign in flow.
  return transitions((style, isSubmitted) =>
    isSubmitted ? (
      <a.div style={style}>{SubmittedFlow}</a.div>
    ) : (
      <a.div style={style}>{SignInFlow}</a.div>
    )
  )
}
