import React from "react"
import { Alert, Snackbar } from "@mui/material"

import SnackbarContext from "./SnackbarAlertContext"

export default function SnackbarAlert() {
  const {snackbar, setSnackbar} = React.useContext(SnackbarContext)

  const handleClose = () => setSnackbar(null)

  return (
    <Snackbar
      open={!!snackbar}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClose={handleClose}
      autoHideDuration={6000}
    >
      <Alert {...snackbar} onClose={handleClose} />
    </Snackbar>
  )
}
