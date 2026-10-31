import React from "react"
import {
  Stack,
  Stepper,
  Step,
  StepLabel,
  Typography,
  CircularProgress,
} from "@mui/material"
import { animated as a, useTransition } from "@react-spring/web"
import CheckoutFlowContext from "./CheckoutFlowContext"
import { TriangleBorder } from "@components/FullScreenDesign"

/**
 * note that endIndex is inclusive; if omitted, implicitly equals startIndex
 */
type CheckoutStepTitle = {
  stepIndex: number
  endIndex?: number
  title: string
}

type CheckoutFlowProps = {
  title: string
  loading: boolean
  canAccess?: boolean
  blockedComponent?: React.ReactNode
  checkoutStepTitles: CheckoutStepTitle[]
  checkoutSteps: React.ReactNode[]
  completionScreen: React.ReactNode
  skipToCompletionScreen: boolean
  reviewStepIndex?: number
}

export default function CheckoutFlow({
  title,
  loading,
  blockedComponent,
  canAccess = true,
  checkoutStepTitles,
  checkoutSteps,
  completionScreen,
  skipToCompletionScreen,
  reviewStepIndex,
}: CheckoutFlowProps) {
  const [activeStep, setActiveStep] = React.useState(
    skipToCompletionScreen ? Number.MAX_VALUE : 0
  )
  const isCompletionScreen =
    skipToCompletionScreen || activeStep >= checkoutSteps.length
  const transitions = useTransition(activeStep, {
    from: { opacity: 0, transform: `translate3d(0,15%,0)`, width: "100%" },
    enter: { opacity: 1, transform: `translate3d(0,0,0)`, width: "100%" },
    leave: { opacity: 0, transform: `translate3d(0,-10%,0)`, width: "100%" },
    exitBeforeEnter: true, // So that we don't try to render both on-screen at a time.
    expires: true, // un-mount the component once it leaves the view.
    config: {
      tension: 300,
      clamp: true,
    },
  })

  React.useEffect(() => {
    const urlSearchParams = new URLSearchParams(window.location.search)

    if (urlSearchParams.has("success")) {
      // Failure = 0 so we go to the review step. Success = 1 so we go to the completion screen
      setActiveStep(reviewStepIndex + parseInt(urlSearchParams.get("success")))
    } else if (parseInt(urlSearchParams.get("continueFromWaitlist"))) {
      // Continue from waitlist should bring us directly to the review step.
      setActiveStep(reviewStepIndex)
    }
  }, [reviewStepIndex])

  const contextValue = React.useMemo(
    () => ({ activeStep, setActiveStep }),
    [activeStep]
  )

  return (
    <CheckoutFlowContext.Provider value={contextValue}>
      <Stack
        sx={{
          padding: 1,
          paddingTop: { xs: 2, md: 4 },
        }}
        spacing={2}
        alignItems="center"
      >
        <Typography variant="h2" textAlign="center" color="primary">
          {title}
        </Typography>
        <Stepper
          activeStep={activeStep}
          sx={{ paddingTop: 2, width: 1 }}
          alternativeLabel
        >
          {checkoutStepTitles.map(({ stepIndex, endIndex, title }) => (
            <Step
              key={title}
              completed={activeStep > (endIndex ?? stepIndex)}
              active={
                activeStep >= stepIndex && activeStep <= (endIndex ?? stepIndex)
              }
            >
              <StepLabel>
                <Typography variant="h6">{title}</Typography>
              </StepLabel>
            </Step>
          ))}
        </Stepper>
        {isCompletionScreen && <TriangleBorder />}
        {loading && <CircularProgress />}
        {!loading &&
          canAccess &&
          transitions((style, index) => (
            <a.div style={style}>
              {index < checkoutSteps.length
                ? checkoutSteps[index]
                : completionScreen}
            </a.div>
          ))}
        {!loading && !canAccess && blockedComponent}
      </Stack>
    </CheckoutFlowContext.Provider>
  )
}
