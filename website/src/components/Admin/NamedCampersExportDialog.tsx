import * as React from "react"
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material"

import { RegistrationData } from "@hooks/useRegistrations"
import { downloadCsv, toCsv } from "@utils/csv"

import {
  exportFileName,
  matchCampersByName,
  namedCampersTable,
} from "./registrationExports"

type NamedCampersExportDialogProps = {
  open: boolean
  onClose: () => void
  // Every registration for the camp year, not just the filtered rows.
  registrations: RegistrationData[]
  campYear: number
}

type Result = { exported: number; notFound: string[] }

// Dashboard version of scripts/src/getParentEmailsForCamper.ts: paste a list
// of camper names, get a CSV of their parents' emails.
export default function NamedCampersExportDialog({
  open,
  onClose,
  registrations,
  campYear,
}: NamedCampersExportDialogProps) {
  const [text, setText] = React.useState("")
  const [result, setResult] = React.useState<Result | null>(null)

  const names = text
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  const handleExport = () => {
    const { matched, notFound } = matchCampersByName(registrations, names)
    if (matched.length > 0) {
      downloadCsv(
        exportFileName(campYear, "parent-emails-for-campers"),
        toCsv(namedCampersTable(matched))
      )
    }
    setResult({ exported: matched.length, notFound })
  }

  const handleClose = () => {
    setResult(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Parent emails for specific campers</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            One camper per line (or comma separated), as "First Last" or
            "Preferred Last". Matches any registration for {campYear}, whatever
            its status.
          </DialogContentText>
          <TextField
            autoFocus
            multiline
            minRows={6}
            fullWidth
            label="Camper names"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setResult(null)
            }}
          />
          {result && result.exported > 0 && (
            <Alert severity="success">
              Downloaded parent emails for {result.exported}{" "}
              {result.exported === 1 ? "camper" : "campers"}.
            </Alert>
          )}
          {result && result.notFound.length > 0 && (
            <Alert severity={result.exported > 0 ? "warning" : "error"}>
              Not found in {campYear}: {result.notFound.join(", ")}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          disabled={names.length === 0}
          onClick={handleExport}
        >
          Download CSV
        </Button>
      </DialogActions>
    </Dialog>
  )
}
