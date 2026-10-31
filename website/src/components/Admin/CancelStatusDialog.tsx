import React from "react"
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Typography,
} from "@mui/material"
import { format } from "date-fns"

// Components
import { TableValidRow } from "@components/Table"

export interface RowWithStatusAndNotes extends TableValidRow {
  name: string
  status: string
  internalNotes: string
}

// Generic over the grid's row type so a dashboard gets its own rows back from
// resolve/updateRow instead of the widened base type.
export type CancelStatusPromise<
  Row extends RowWithStatusAndNotes = RowWithStatusAndNotes
> = {
  newRow: Row
  oldRow: Row
  resolve: (value: Row | PromiseLike<Row>) => void
  reject: (reason?: unknown) => void
}

export type CancelStatusDialogProps<Row extends RowWithStatusAndNotes> = {
  context: CancelStatusPromise<Row> | null
  setContext: React.Dispatch<CancelStatusPromise<Row> | null>
  updateRow: (newRow: Row, cancelText: string) => Promise<void>
}

export default function CancelStatusDialog<Row extends RowWithStatusAndNotes>({
  context,
  setContext,
  updateRow,
}: CancelStatusDialogProps<Row>) {
  const [cancelText, setCancelText] = React.useState<string | null>("")
  const handleTextChange = (event: React.BaseSyntheticEvent) => {
    setCancelText(event.target.value as string)
  }
  const cancelDateText = `Cancelling ${format(new Date(), "M/d/yy")}: `
  React.useEffect(() => {
    if (context) {
      setCancelText(context.newRow.internalNotes)
    }
  }, [context])

  const handleClose = () => {
    context?.reject(new Error("Not confirmed."))
    setContext(null)
  }

  const handleConfirmation = async () => {
    if (!context) {
      return
    }
    const { newRow, resolve, reject } = context

    try {
      await updateRow(newRow, `${cancelDateText}${cancelText || ""}`)
      resolve(newRow)
    } catch {
      reject(new Error("Failed to update row."))
    }
    setContext(null)
  }

  return (
    <Dialog open={!!context} onClose={handleClose}>
      <DialogTitle>Cancel camper</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to cancel registration for{" "}
          {context?.newRow.name}?
        </DialogContentText>
        <TextField
          id="set-cancellation-status-text"
          label="Cancellation Reason"
          onChange={handleTextChange}
          InputProps={{
            startAdornment: (
              <Typography variant="body1" width="15rem">{cancelDateText}</Typography>
            ),
          }}
          sx={{
            marginTop: 2,
          }}
          multiline
          fullWidth
          value={cancelText}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>No</Button>
        <Button onClick={handleConfirmation} autoFocus>
          Yes
        </Button>
      </DialogActions>
    </Dialog>
  )
}
