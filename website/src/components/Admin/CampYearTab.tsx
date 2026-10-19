import React from "react"
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker"
import { Dayjs } from "dayjs"
import { collection, doc, getDocs } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { useDocumentData } from "react-firebase-hooks/firestore"
import {
  CAMP_YEAR_DATE_KEYS,
  CAMP_YEAR_FEE_KEYS,
  CAMP_YEAR_TEXT_KEYS,
  CampTrack,
  CampYear,
  CampYearConfigInput,
  CampYearDateKey,
  CampYearFeeKey,
  CampYearTextKey,
  FUNCTION_NAMES,
  ManageCampYearRequest,
  ManageCampYearResponse,
  normalizeEmail,
} from "lyf-registration-schemas"

import { ProdContext } from "@components/ProdContext"
import { SnackbarAlertContext } from "@components/SnackbarAlert"
import { firebaseFunctions } from "@utils/firebaseApp"
import { CAMP_TIME_ZONE, timestampToCampTime } from "@utils/campTime"
import useSiteConfig from "@hooks/useSiteConfig"

// All camp-year writes go through the function: Firestore rules deny client
// writes to camps/{year} and config/ so the key whitelist, date-order checks
// and audit log always apply.
const manageCampYear = httpsCallable<
  ManageCampYearRequest,
  ManageCampYearResponse
>(firebaseFunctions, FUNCTION_NAMES.manageCampYear)

const errorMessage = (err: unknown, fallback: string) =>
  (err as { message?: string })?.message ?? fallback

const DATE_LABELS: Record<CampYearDateKey, string> = {
  preRegistrationOpenDate: "Pre-registration opens",
  preRegistrationCloseDate: "Pre-registration closes",
  earlyRegOpenDate: "Registration opens (pre-registered)",
  earlyRegEndDate: "Early registration ends",
  registrationOpenDate: "Registration opens (everyone)",
  registrationLateDate: "Late fee starts",
  registrationCloseDate: "Registration closes",
  infoSessionDate: "Virtual info session",
  campStartDate: "Camp starts",
  campEndDate: "Camp ends",
}

const FEE_LABELS: Record<CampYearFeeKey, string> = {
  preRegistrationFee: "Pre-registration fee ($)",
  registrationFee: "Registration fee ($)",
  registrationLateFee: "Late registration fee ($)",
  shirtPrice: "Shirt price ($)",
  siblingDiscount: "Sibling discount ($)",
}

const TEXT_LABELS: Record<CampYearTextKey, string> = {
  name: "Name",
  campsite: "Campsite",
  campsiteAddress: "Campsite address",
}

const TRACKS = Object.values(CampTrack)

type FormState = {
  dates: Record<CampYearDateKey, Dayjs | null>
  fees: Record<CampYearFeeKey, string>
  texts: Record<CampYearTextKey, string>
  campTotalSizeCap: string
  campSizeCaps: Record<CampTrack, string>
  bypassEmails: string[]
}

const numberToField = (n: number | undefined) =>
  typeof n === "number" ? String(n) : ""

function formFromCampYear(camp: CampYear | undefined): FormState {
  const dates = {} as FormState["dates"]
  for (const key of CAMP_YEAR_DATE_KEYS) {
    dates[key] = timestampToCampTime(camp?.[key])
  }
  const fees = {} as FormState["fees"]
  for (const key of CAMP_YEAR_FEE_KEYS) {
    fees[key] = numberToField(camp?.[key])
  }
  const texts = {} as FormState["texts"]
  for (const key of CAMP_YEAR_TEXT_KEYS) {
    texts[key] = camp?.[key] ?? ""
  }
  const campSizeCaps = {} as FormState["campSizeCaps"]
  for (const track of TRACKS) {
    campSizeCaps[track] = numberToField(camp?.campSizeCaps?.[track])
  }
  return {
    dates,
    fees,
    texts,
    campTotalSizeCap: numberToField(camp?.campTotalSizeCap),
    campSizeCaps,
    bypassEmails: camp?.registrationBypassEmails ?? [],
  }
}

/**
 * Turns the form into the callable payload. Empty inputs are left out so a
 * half-filled year can still be saved; the function validates the rest.
 */
function formToInput(form: FormState): CampYearConfigInput {
  const input: CampYearConfigInput = {}
  for (const key of CAMP_YEAR_DATE_KEYS) {
    const d = form.dates[key]
    if (d && d.isValid()) input[key] = d.toISOString()
  }
  for (const key of CAMP_YEAR_FEE_KEYS) {
    if (form.fees[key].trim() !== "") input[key] = Number(form.fees[key])
  }
  for (const key of CAMP_YEAR_TEXT_KEYS) {
    input[key] = form.texts[key]
  }
  if (form.campTotalSizeCap.trim() !== "") {
    input.campTotalSizeCap = Number(form.campTotalSizeCap)
  }
  const caps = {} as Record<CampTrack, number>
  let anyCap = false
  for (const track of TRACKS) {
    if (form.campSizeCaps[track].trim() !== "") {
      caps[track] = Number(form.campSizeCaps[track])
      anyCap = true
    }
  }
  if (anyCap) input.campSizeCaps = caps
  input.registrationBypassEmails = form.bypassEmails
  return input
}

export default function CampYearTab() {
  const { firestore, isTestData } = React.useContext(ProdContext)
  const { setSnackbar } = React.useContext(SnackbarAlertContext)
  const { currentCampYear, preRegistrationCampYear, loading: configLoading } =
    useSiteConfig()

  const [years, setYears] = React.useState<number[]>([])
  const [yearsLoading, setYearsLoading] = React.useState(true)
  const [selectedYear, setSelectedYear] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormState>(() => formFromCampYear(undefined))
  const [dirty, setDirty] = React.useState(false)
  const [emailInput, setEmailInput] = React.useState("")

  const loadYears = React.useCallback(async () => {
    setYearsLoading(true)
    try {
      const snapshot = await getDocs(collection(firestore, "camps"))
      const found = snapshot.docs
        .map((d) => Number(d.id))
        .filter((y) => Number.isInteger(y))
        .sort((a, b) => b - a)
      setYears(found)
      return found
    } catch (err) {
      setSnackbar({
        children: errorMessage(err, "Failed to load camp years"),
        severity: "error",
      })
      return []
    } finally {
      setYearsLoading(false)
    }
  }, [firestore, setSnackbar])

  React.useEffect(() => {
    loadYears()
  }, [loadYears])

  // Default the selector to the current camp year once both are known.
  React.useEffect(() => {
    if (selectedYear !== null || years.length === 0) return
    setSelectedYear(
      currentCampYear && years.includes(currentCampYear) ? currentCampYear : years[0]
    )
  }, [years, currentCampYear, selectedYear])

  const [camp, campLoading] = useDocumentData<CampYear>(
    selectedYear !== null ? doc(firestore, `camps/${selectedYear}`) : null
  )

  // Reset the form whenever a different year (or a fresh copy of it) arrives,
  // but never over the admin's unsaved edits.
  React.useEffect(() => {
    if (campLoading || dirty) return
    setForm(formFromCampYear(camp))
  }, [camp, campLoading, dirty])

  React.useEffect(() => {
    setDirty(false)
  }, [selectedYear])

  const update = (patch: (prev: FormState) => FormState) => {
    setForm(patch)
    setDirty(true)
  }

  const run = async (
    label: string,
    request: ManageCampYearRequest,
    success: string,
    after?: (res: ManageCampYearResponse) => Promise<void> | void
  ) => {
    setBusy(label)
    try {
      const res = await manageCampYear({ ...request, isTestData })
      setSnackbar({ children: success, severity: "success" })
      await after?.(res.data)
    } catch (err) {
      setSnackbar({
        children: errorMessage(err, `Failed to ${label.toLowerCase()}`),
        severity: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const handleSave = () => {
    if (selectedYear === null) return
    run(
      "Save",
      { action: "updateYear", year: selectedYear, fields: formToInput(form) },
      `Saved camps/${selectedYear}`,
      () => setDirty(false)
    )
  }

  const handleCreateNext = () => {
    if (selectedYear === null) return
    const year = selectedYear + 1
    run(
      "Create next year",
      { action: "createYear", year, sourceYear: selectedYear },
      `Created camps/${year} from ${selectedYear} — review its dates and save`,
      async () => {
        await loadYears()
        setDirty(false)
        setSelectedYear(year)
      }
    )
  }

  const handleSetCurrent = () => {
    if (selectedYear === null) return
    run(
      "Set current camp year",
      { action: "setSiteConfig", config: { currentCampYear: selectedYear } },
      `${selectedYear} is now the current camp year`
    )
  }

  const handleSetPreRegistration = () => {
    if (selectedYear === null) return
    run(
      "Set pre-registration year",
      { action: "setSiteConfig", config: { preRegistrationCampYear: selectedYear } },
      `${selectedYear} is now the pre-registration year`
    )
  }

  const addEmail = () => {
    const email = normalizeEmail(emailInput)
    if (!email.includes("@")) return
    update((prev) => ({
      ...prev,
      bypassEmails: prev.bypassEmails.includes(email)
        ? prev.bypassEmails
        : [...prev.bypassEmails, email],
    }))
    setEmailInput("")
  }

  const removeEmail = (email: string) =>
    update((prev) => ({
      ...prev,
      bypassEmails: prev.bypassEmails.filter((e) => e !== email),
    }))

  if (configLoading || yearsLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    )
  }

  const disabled = busy !== null || selectedYear === null || campLoading

  return (
    <Stack spacing={3} sx={{ maxWidth: 900, mx: "auto", py: 2 }}>
      <Typography variant="h5">Camp Year</Typography>

      <Alert severity={isTestData ? "warning" : "info"}>
        Editing the {isTestData ? "test" : "production"} database. Current camp
        year: <b>{currentCampYear ?? "not set"}</b>. Pre-registration year:{" "}
        <b>{preRegistrationCampYear ?? "not set"}</b>.
      </Alert>

      {years.length === 0 ? (
        <Alert severity="error">
          No camps/&#123;year&#125; documents exist in this database. Seed one
          with scripts/src/resetCampYearInfo.ts, then manage it here.
        </Alert>
      ) : (
        <>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Camp year</InputLabel>
              <Select
                value={selectedYear ?? ""}
                label="Camp year"
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                disabled={busy !== null}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}
                    {y === currentCampYear ? " (current)" : ""}
                    {y === preRegistrationCampYear ? " (pre-registration)" : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              onClick={handleCreateNext}
              disabled={disabled || (selectedYear !== null && years.includes(selectedYear + 1))}
            >
              Create {selectedYear !== null ? selectedYear + 1 : "next year"} from{" "}
              {selectedYear ?? "selected"}
            </Button>
            <Button
              variant="outlined"
              onClick={handleSetCurrent}
              disabled={disabled || selectedYear === currentCampYear}
            >
              Set as current camp year
            </Button>
            <Button
              variant="outlined"
              onClick={handleSetPreRegistration}
              disabled={disabled || selectedYear === preRegistrationCampYear}
            >
              Set as pre-registration year
            </Button>
          </Stack>

          {campLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={3}>
              <Divider textAlign="left">Details</Divider>
              <Grid container spacing={2}>
                {CAMP_YEAR_TEXT_KEYS.map((key) => (
                  <Grid key={key} size={{ xs: 12, md: key === "name" ? 12 : 6 }}>
                    <TextField
                      label={TEXT_LABELS[key]}
                      value={form.texts[key]}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          texts: { ...prev.texts, [key]: e.target.value },
                        }))
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                ))}
              </Grid>

              <Divider textAlign="left">Dates (Pacific time)</Divider>
              <Grid container spacing={2}>
                {CAMP_YEAR_DATE_KEYS.map((key) => (
                  <Grid key={key} size={{ xs: 12, md: 6 }}>
                    <DateTimePicker
                      label={DATE_LABELS[key]}
                      value={form.dates[key]}
                      timezone={CAMP_TIME_ZONE}
                      onChange={(value) =>
                        update((prev) => ({
                          ...prev,
                          dates: { ...prev.dates, [key]: value },
                        }))
                      }
                      slotProps={{ textField: { size: "small", fullWidth: true } }}
                    />
                  </Grid>
                ))}
              </Grid>

              <Divider textAlign="left">Fees</Divider>
              <Grid container spacing={2}>
                {CAMP_YEAR_FEE_KEYS.map((key) => (
                  <Grid key={key} size={{ xs: 12, sm: 6, md: 4 }}>
                    <TextField
                      label={FEE_LABELS[key]}
                      type="number"
                      inputProps={{ min: 0 }}
                      value={form.fees[key]}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          fees: { ...prev.fees, [key]: e.target.value },
                        }))
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                ))}
              </Grid>

              <Divider textAlign="left">Capacity</Divider>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextField
                    label="Total size cap"
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    value={form.campTotalSizeCap}
                    onChange={(e) =>
                      update((prev) => ({ ...prev, campTotalSizeCap: e.target.value }))
                    }
                    fullWidth
                    size="small"
                  />
                </Grid>
                {TRACKS.map((track) => (
                  <Grid key={track} size={{ xs: 12, sm: 6, md: 4 }}>
                    <TextField
                      label={`${track} track cap`}
                      type="number"
                      inputProps={{ min: 0, step: 1 }}
                      value={form.campSizeCaps[track]}
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          campSizeCaps: { ...prev.campSizeCaps, [track]: e.target.value },
                        }))
                      }
                      helperText={
                        camp?.remainingSpots
                          ? `${camp.remainingSpots[track] ?? 0} spots remaining (function-managed)`
                          : undefined
                      }
                      fullWidth
                      size="small"
                    />
                  </Grid>
                ))}
              </Grid>

              <Divider textAlign="left">Registration bypass emails</Divider>
              <Typography variant="body2" color="text.secondary">
                These families can use the registration page after it closes.
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  label="Email address"
                  type="email"
                  size="small"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addEmail()
                    }
                  }}
                  sx={{ flexGrow: 1 }}
                />
                <Button onClick={addEmail} disabled={!emailInput.includes("@")}>
                  Add
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {form.bypassEmails.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No bypass emails.
                  </Typography>
                )}
                {form.bypassEmails.map((email) => (
                  <Chip key={email} label={email} onDelete={() => removeEmail(email)} />
                ))}
              </Stack>

              <Stack direction="row" spacing={2} alignItems="center">
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={disabled || !dirty}
                >
                  {busy === "Save" ? <CircularProgress size={20} /> : "Save"}
                </Button>
                <Button
                  onClick={() => {
                    setForm(formFromCampYear(camp))
                    setDirty(false)
                  }}
                  disabled={disabled || !dirty}
                >
                  Discard changes
                </Button>
                {dirty && (
                  <Typography variant="body2" color="warning.main">
                    Unsaved changes
                  </Typography>
                )}
              </Stack>
            </Stack>
          )}
        </>
      )}
    </Stack>
  )
}
