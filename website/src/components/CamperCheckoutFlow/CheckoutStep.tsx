import React from "react"
import {
  Box,
  Card,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { httpsCallable } from "firebase/functions"
import { FUNCTION_NAMES } from "lyf-registration-schemas"
import { serverTimestamp, updateDoc } from "firebase/firestore"

// Schema
import {
  PreRegistrationInputPayload,
  PreRegistrationResponsePayload,
} from "lyf-registration-schemas"

// Components
import { CheckoutFlowStep } from "@components/CheckoutFlow"
import { CamperWithRegistration } from "./CamperCheckoutFlow"

// Utils
import AuthContext from "@components/Auth/AuthContext"
import ProdContext from "@components/ProdContext"
import { firebaseFunctions } from "@utils/firebaseApp"

type CheckoutProps = {
  nextCampYear: number
  campers: CamperWithRegistration[]
  preRegisteredCampersIds: string[]
  setPreRegisteredCampersIds: React.Dispatch<string[]>
  donationAmount: number
  /** Per-camper price from camps/{nextCampYear}.preRegistrationFee. */
  preRegistrationFee: number
  hideCamperCheckout?: boolean
}

const Cost = ({ cost }: { cost: number }) => (
  <Typography>
    <b>${cost}</b>
  </Typography>
)

// Will need to store local variables on Stripe checkout
export default function CheckoutStep({
  nextCampYear,
  campers,
  preRegisteredCampersIds,
  donationAmount,
  preRegistrationFee,
  hideCamperCheckout = false,
}: CheckoutProps) {
  const { user } = React.useContext(AuthContext)
  const { getStripe, isTestData } = React.useContext(ProdContext)
  const [error, setError] = React.useState<string | null>(null)
  const [parentName, setParentName] = React.useState<string>("")
  const total =
    preRegisteredCampersIds.length * preRegistrationFee + donationAmount
  const preRegisteredCampers = campers.filter((camper) =>
    preRegisteredCampersIds.includes(camper.id)
  )
  const hasCampersToCheckout =
    !hideCamperCheckout &&
    campers.find(
      (camper) => camper.isActiveThisYear && !camper.isCheckedOut
    ) !== undefined

  const handleStripeCheckout = async () => {
    // There's nothing to pay, so don't create a stripe session id
    if (total <= 0) {
      return null
    }

    const stripe = await getStripe()
    if (!stripe) {
      return null
    }
    const createPreRegistrationSession = httpsCallable<
      PreRegistrationInputPayload,
      PreRegistrationResponsePayload
    >(firebaseFunctions, FUNCTION_NAMES.createPreRegistrationSession)

    let checkoutSessionId: string | null | undefined = null
    try {
      const response = await createPreRegistrationSession({
        campYear: nextCampYear,
        campersToPreRegister: preRegisteredCampers.map(
          (camper) => `${camper.firstName} ${camper.lastName}`
        ),
        camperRefsToPreRegister: preRegisteredCampers.map(
          (camper) => camper.ref.path
        ),
        camperCurrentGrades: preRegisteredCampers.map(
          (camper) => camper.currentGrade
        ),
        donationAmount: donationAmount,
        email: user?.email as string,
        successUrl: `${window.location.origin}${window.location.pathname}?success=1`,
        cancelUrl: `${window.location.origin}${window.location.pathname}?success=0`,
        isTestData: isTestData,
      })

      if (response.data.status === "error") {
        setError("Unable to create Stripe checkout session")
      }

      checkoutSessionId = response.data.sessionId
    } catch (error) {
      setError("Unable to create Stripe checkout session")
    }

    return checkoutSessionId
  }

  const checkoutHandler = async () => {
    // We don't await here because we want to start the execution but not yet
    // wait for the response
    const waitForStripeId = handleStripeCheckout()

    if (!hideCamperCheckout) {
      // Mark all the campers as checked out
      await Promise.all(
        campers.map(async (camper) => {
          // If we have an active registration and the camper isn't already checked out,
          // then mark the camper as checked out.
          if (!!camper.activeReg && !camper.isCheckedOut) {
            updateDoc(camper.activeReg, {
              isCheckedOut: true,
              nameOfParentCheckedOut: parentName,
              checkedOutTime: serverTimestamp(),
            })
          }
        })
      )
    }
    const checkoutSessionId = await waitForStripeId
    if (checkoutSessionId) {
      const stripe = await getStripe()
      await stripe?.redirectToCheckout({
        sessionId: checkoutSessionId,
      })
    }
  }

  return (
    <CheckoutFlowStep
      index={3}
      title="Checkout"
      continueText={
        hasCampersToCheckout && parentName.length <= 0
          ? "Please enter a name"
          : "Checkout"
      }
      continueHandler={checkoutHandler}
      disableContinue={hasCampersToCheckout && parentName.length <= 0}
    >
      <Container
        maxWidth="md"
        sx={{ paddingTop: 1, paddingBottom: 1 }}
        disableGutters
      >
        <Stack spacing={2}>
          <Card variant="outlined">
            <List disablePadding>
              {campers.map((camper, index) => {
                // If the camper is just checking out, then we only have the primary checking out text.
                // If the camper is checking out and pre-registered, then the primary text is checking out and secondary is pre-register
                // If the camper is already checked out and pre-registered, then the primary text is pre-register
                const shouldPreRegister = preRegisteredCampersIds.includes(
                  camper.id
                )
                const shouldCheckOut =
                  !hideCamperCheckout &&
                  camper.isActiveThisYear &&
                  !camper.isCheckedOut
                const camperName = `${camper.firstName} ${camper.lastName}`

                // If the camper is already checked out and we're not pre-registering them, then there's nothing to display for the checkout.
                if (!shouldCheckOut && !shouldPreRegister) {
                  return <></>
                }

                return (
                  <Box key={camperName + index}>
                    <ListItem
                      secondaryAction={
                        <Cost cost={shouldCheckOut ? 0 : preRegistrationFee} />
                      }
                    >
                      <ListItemText
                        primary={
                          shouldCheckOut
                            ? `Camper Checkout: ${camperName}`
                            : `LYF Camp ${nextCampYear} Pre-Registration: ${camperName}`
                        }
                      />
                    </ListItem>
                    {shouldCheckOut && shouldPreRegister && (
                      <ListItem
                        secondaryAction={<Cost cost={preRegistrationFee} />}
                      >
                        <ListItemText
                          primary={`LYF Camp ${nextCampYear} Pre-Registration`}
                          sx={{
                            paddingLeft: {
                              xs: 2,
                              lg: 4,
                            },
                          }}
                        />
                      </ListItem>
                    )}
                  </Box>
                )
              })}

              {donationAmount > 0 && (
                <>
                  <Divider />
                  <ListItem secondaryAction={<Cost cost={donationAmount} />}>
                    <ListItemText primary="Donation" />
                  </ListItem>
                </>
              )}
              <Divider />
              <ListItem
                secondaryAction={<Cost cost={total} />}
                sx={{
                  backgroundColor: "offwhite",
                }}
              >
                <ListItemText primary={<b>Total</b>} />
              </ListItem>
            </List>
          </Card>
          {hasCampersToCheckout && (
            <TextField
              id="parent-checkout-name"
              label="Name of parent checking out camper(s)"
              fullWidth
              variant="outlined"
              value={parentName}
              onChange={(event) => setParentName(event.currentTarget.value)}
            />
          )}
          {!!error && (
            <Typography
              variant="h6"
              textAlign="center"
              sx={{ padding: 2, color: "secondary.main" }}
            >
              {error}
            </Typography>
          )}
        </Stack>
      </Container>
    </CheckoutFlowStep>
  )
}
