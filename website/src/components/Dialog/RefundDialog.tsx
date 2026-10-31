import { AnimatedButtonWithLoading } from "@components/Button"
import ProdContext from "@components/ProdContext"
import {
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material"
import { NumberInput } from "@components/Inputs"
import { firebaseFunctions } from "@utils/firebaseApp"
import { updateDoc, serverTimestamp } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { FUNCTION_NAMES } from "lyf-registration-schemas"
import { Payment } from "@utils/databaseSchema"
import { RegistrationData } from "@hooks/useRegistrations"
import { RegistrationStatus } from "lyf-registration-schemas"
import React from "react"

type IssueStripeRefundRequest = {
  stripeId: string
  amount: number
  isTestData: boolean
}

type IssueStripeRefundResponse = {
  status: string
  code: number
  message: string
}

type RefundDialogEntryProps = {
  registration: RegistrationData
  payments: Payment[]
  handleRefundChange: (
    regKey: RegistrationData["registrationRef"]["id"],
    payment: Payment,
    value: number
  ) => void
  handleCancelChange: (reg: RegistrationData, cancelled: boolean) => void
}

type RefundDialogProps = {
  refundPayments: Map<RegistrationData, Payment[]>
  open: boolean
  setOpen: (b: boolean) => void
}

const PaymentTypography = (props: { payment: Payment }) => {
  const { payment } = props

  const ItemTypography = (props: { amount: number; description: string }) => {
    const { amount, description } = props

    return (
      <span>
        <Typography
          component="span"
          sx={{ color: "text.primary" }}
          variant="body2"
        >
          {amount}
        </Typography>
        <Typography
          component="span"
          sx={{ color: "text.secondary" }}
          variant="body2"
        >
          {` — ${description}`}
        </Typography>
      </span>
    )
  }

  return (
    <Stack sx={{ pl: 2 }}>
      <Typography variant="body1">
        {`${payment.customerName} (${payment.customerEmail})`}
      </Typography>
      {!payment.donation ? (
        <></>
      ) : (
        <ItemTypography amount={payment.donation} description="Donation" />
      )}
      {payment.items?.map((item, idx) => (
        <ItemTypography
          key={`${payment.id}-item${idx}`}
          amount={item.amount}
          description={item.description}
        />
      ))}
    </Stack>
  )
}

const CancellationCheckbox = (props: {
  registration: RegistrationData
  handleCancelChange: (reg: RegistrationData, cancelled: boolean) => void
}) => {
  const { registration, handleCancelChange } = props

  return (
    <FormControlLabel
      labelPlacement="start"
      control={
        <Checkbox
          onChange={(e) => handleCancelChange(registration, e.target.checked)}
          disabled={registration.status === RegistrationStatus.CANCELLED}
        />
      }
      label="Cancel Registration"
    />
  )
}

const RefundInput = (props: {
  regKey: RegistrationData["registrationRef"]["id"]
  payment: Payment
  handleRefundChange: RefundDialogEntryProps["handleRefundChange"]
}) => {
  const { regKey, payment, handleRefundChange } = props

  return (
    <NumberInput
      onChange={(_, value) => handleRefundChange(regKey, payment, value)}
      disabled={!(payment.balance || payment.total)}
      max={payment.balance ?? payment.total}
      min={0}
      placeholder={`Balance: ${payment.balance ?? payment.total}`}
    />
  )
}

const RefundDialogEntry = ({
  registration,
  payments,
  handleRefundChange,
  handleCancelChange,
}: RefundDialogEntryProps) => {
  const [open, setOpen] = React.useState(true)

  return (
    <>
      <ListItem
        disablePadding
        divider
        secondaryAction={
          <CancellationCheckbox
            registration={registration}
            handleCancelChange={handleCancelChange}
          />
        }
      >
        <ListItemButton onClick={() => setOpen(!open)}>
          <ListItemText primary={registration.camperName} />
        </ListItemButton>
      </ListItem>
      <Collapse in={open} timeout="auto">
        <List component="div" disablePadding>
          {payments.length === 0 ? (
            <ListItem divider sx={{ pl: 4 }}>
              <ListItemText
                primary={`No payments found for ${registration.camperName}`}
              ></ListItemText>
            </ListItem>
          ) : (
            payments.map((payment) => (
              <ListItem
                key={payment.id}
                divider
                secondaryAction={
                  <RefundInput
                    regKey={registration.registrationRef.id}
                    payment={payment}
                    handleRefundChange={handleRefundChange}
                  />
                }
              >
                <PaymentTypography payment={payment} />
              </ListItem>
            ))
          )}
        </List>
      </Collapse>
    </>
  )
}

export default function RefundDialog({
  refundPayments,
  open,
  setOpen,
}: RefundDialogProps) {
  const { isTestData } = React.useContext(ProdContext)
  const [changes, setChanges] = React.useState(0)

  type RefundMetadata = {
    amount: number
    payment: Payment
  }

  const changesRef = React.useRef({
    refunds: new Map<Payment["id"], RefundMetadata>(),
    cancellations: new Set<RegistrationData>(),
  })

  const updateChangeCount = (c: boolean) => setChanges(changes + (c ? 1 : -1))

  const handleRefundChange = (
    regKey: string,
    payment: Payment,
    value: number
  ) => {
    if (value) {
      changesRef.current.refunds.set(regKey, { amount: value, payment })
    } else {
      changesRef.current.refunds.delete(regKey)
    }
    updateChangeCount(value !== null)
  }

  const handleCancelChange = (reg: RegistrationData, cancelled: boolean) => {
    if (cancelled) {
      changesRef.current.cancellations.add(reg)
    } else {
      changesRef.current.cancellations.delete(reg)
    }
    updateChangeCount(cancelled)
  }

  const handleDialogClose = () => {
    setOpen(false)
    setChanges(0)
  }

  const issueStripeRefund = httpsCallable<
    IssueStripeRefundRequest,
    IssueStripeRefundResponse
  >(firebaseFunctions, FUNCTION_NAMES.issueStripeRefund)

  const handleRefunds = async () => {
    await Promise.all(
      [...changesRef.current.refunds.entries()].map(async ([, metadata]) => {
        try {
          await issueStripeRefund({
            stripeId: metadata.payment.stripeId,
            amount: metadata.amount * 100, // dollars -> cents
            isTestData: isTestData,
          })
          await updateDoc(metadata.payment.ref, {
            balance:
              (metadata.payment.balance ?? metadata.payment.total!) -
              metadata.amount,
          })
        } catch (e) {
          console.error("Refund failed", e)
        }
      })
    )
    await Promise.all(
      [...changesRef.current.cancellations.values()].map(async (reg) =>
        updateDoc(reg.registrationRef, {
          status: RegistrationStatus.CANCELLED,
          updatedAt: serverTimestamp(),
        })
      )
    )
    changesRef.current.refunds.clear()
    changesRef.current.cancellations.clear()
    handleDialogClose()
  }

  return (
    <Dialog fullWidth maxWidth="md" open={open} onClose={handleDialogClose}>
      <DialogTitle>Input refund amounts in USD</DialogTitle>
      <DialogContent>
        <List>
          {[...refundPayments.entries()].map(([registration, payments]) => (
            <RefundDialogEntry
              key={registration.registrationRef.id}
              registration={registration}
              payments={payments}
              handleRefundChange={handleRefundChange}
              handleCancelChange={handleCancelChange}
            />
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDialogClose}>Cancel</Button>
        <AnimatedButtonWithLoading
          asyncOnClick={handleRefunds}
          // No onMouseDown preventDefault here: the refund NumberInputs
          // commit their value on blur, and pressing this button is what
          // blurs the field being edited.
          variant="outlined"
          boopProps={{}}
          disabled={!(changes > 0)}
        >
          Submit Refunds and Cancellations
        </AnimatedButtonWithLoading>
      </DialogActions>
    </Dialog>
  )
}
