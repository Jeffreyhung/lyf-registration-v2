import React from "react"

import {
  SnackbarAlertType,
  SnackbarAlertContext,
  SnackbarAlert,
} from "@components/SnackbarAlert"

type SnackbarAlertProviderProps = {
  children: React.ReactNode | React.ReactNode[]
}

export default function SnackbarAlertProvider({
  children,
}: SnackbarAlertProviderProps) {
  const [snackbar, setSnackbar] = React.useState<SnackbarAlertType>(null)
  // Stable identity so consumers (every grid and form under the provider)
  // only re-render when the snackbar itself changes.
  const providerValue = React.useMemo(
    () => ({
      snackbar: snackbar,
      setSnackbar: setSnackbar,
    }),
    [snackbar]
  )

  return (
    <SnackbarAlertContext.Provider value={providerValue}>
      {children}
      <SnackbarAlert />
    </SnackbarAlertContext.Provider>
  )
}
