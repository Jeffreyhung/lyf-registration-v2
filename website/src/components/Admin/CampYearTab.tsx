import React from "react"
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
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
  CAMP_YEAR_FLAG_KEYS,
  CAMP_YEAR_IMAGE_URL_KEYS,
  CAMP_YEAR_TEXT_KEYS,
  CampTrack,
  CampYear,
  CampYearConfigInput,
  CampYearDateKey,
  CampYearFeeKey,
  CampYearFlagKey,
  CampYearImageUrlKey,
  CampYearTextKey,
  FUNCTION_NAMES,
  isAllowedImageUrl,
  isMailchimpListId,
  ManageCampYearRequest,
  ManageCampYearResponse,
  MAX_IMAGE_URL_LENGTH,
  normalizeEmail,
  registrationBypassCollectionPath,
} from "lyf-registration-schemas"

import { ProdContext } from "@components/ProdContext"
import { SnackbarAlertContext } from "@components/SnackbarAlert"
import { firebaseFunctions, prodFirestore } from "@utils/firebaseApp"
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
  infoSessionImageUrl: "Info session banner URL",
  emailHeaderImageUrl: "Email header image URL",
  mailchimpListId: "Mailchimp audience ID",
}

// Helper text for the Details fields that need it.
const TEXT_HELP: Partial<Record<CampYearTextKey, string>> = {
  mailchimpListId:
    "Audience that this year's registered and pre-registered parents are added to (Mailchimp → Audience → Settings → Audience name and defaults → Audience ID). Leave empty to use the general list.",
}

// Mirrors the callable's check so the admin sees the problem before saving.
const MAILCHIMP_LIST_ID_ERROR =
  "Must be a Mailchimp audience ID: lowercase letters and digits, e.g. 2bd94e4a2c"
const textFieldError = (key: CampYearTextKey, value: string) =>
  key === "mailchimpListId" &&
  value.trim() !== "" &&
  !isMailchimpListId(value.trim())
    ? MAILCHIMP_LIST_ID_ERROR
    : undefined

// Image URLs are text keys with their own section (preview + stricter
// validation in the function); the plain Details section skips them.
const IMAGE_URL_KEYS = new Set<string>(CAMP_YEAR_IMAGE_URL_KEYS)
const DETAIL_TEXT_KEYS = CAMP_YEAR_TEXT_KEYS.filter(
  (key) => !IMAGE_URL_KEYS.has(key)
)

const IMAGE_HELP: Record<CampYearImageUrlKey, string> = {
  infoSessionImageUrl:
    "Shown beside the notice on the registration Info step. https:// only; leave empty to use the image bundled with the website.",
  emailHeaderImageUrl:
    "Hero image at the top of the registration, waitlist and off-waitlist emails. https:// only; leave empty to use the template's image.",
}

const FLAG_LABELS: Record<CampYearFlagKey, { label: string; help: string }> = {
  showWaitlistHeaderBar: {
    label: "Show waitlist header bar",
    help: "Banner above the registration flow announcing which tracks are waitlisted.",
  },
  showRemainingSpots: {
    label: "Show remaining spots",
    help: "Spots-remaining line per track on the registration Info step.",
  },
  showWaitlistPosition: {
    label: "Show waitlist position",
    help: "Each waitlisted camper's position on the family profile page.",
  },
}

// Mirrors the callable's check so the admin sees the problem before saving
// (and no preview is attempted for a URL that will be rejected).
const IMAGE_URL_ERROR = `Must be an https:// URL without a username/password, at most ${MAX_IMAGE_URL_LENGTH} characters`

const TRACKS = Object.values(CampTrack)

type FormState = {
  dates: Record<CampYearDateKey, Dayjs | null>
  fees: Record<CampYearFeeKey, string>
  texts: Record<CampYearTextKey, string>
  flags: Record<CampYearFlagKey, boolean>
  campTotalSizeCap: string
  campSizeCaps: Record<CampTrack, string>
  bypassEmails: string[]
}

const numberToField = (n: number | undefined) =>
  typeof n === "number" ? String(n) : ""

function formFromCampYear(
  camp: CampYear | undefined,
  bypassEmails: string[]
): FormState {
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
  const flags = {} as FormState["flags"]
  for (const key of CAMP_YEAR_FLAG_KEYS) {
    flags[key] = camp?.[key] === true
  }
  const campSizeCaps = {} as FormState["campSizeCaps"]
  for (const track of TRACKS) {
    campSizeCaps[track] = numberToField(camp?.campSizeCaps?.[track])
  }
  return {
    dates,
    fees,
    texts,
    flags,
    campTotalSizeCap: numberToField(camp?.campTotalSizeCap),
    campSizeCaps,
    bypassEmails,
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
  for (const key of CAMP_YEAR_FLAG_KEYS) {
    input[key] = form.flags[key]
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
  const [form, setForm] = React.useState<FormState>(() =>
    formFromCampYear(undefined, [])
  )
  // Bypass emails are private per-email docs (camps/{year}/private/bypass/
  // emails), never on the public camp document; admins may list them.
  const [bypassEmails, setBypassEmails] = React.useState<string[]>([])
  const [bypassLoading, setBypassLoading] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [emailInput, setEmailInput] = React.useState("")
  // Test mode only: years that exist in production, offered for copying.
  const [prodYears, setProdYears] = React.useState<number[]>([])
  const [copyYear, setCopyYear] = React.useState<number | "">("")

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

  React.useEffect(() => {
    if (!isTestData) {
      setProdYears([])
      setCopyYear("")
      return undefined
    }
    let cancelled = false
    getDocs(collection(prodFirestore, "camps"))
      .then((snapshot) => {
        if (cancelled) return
        const found = snapshot.docs
          .map((d) => Number(d.id))
          .filter((y) => Number.isInteger(y))
          .sort((a, b) => b - a)
        setProdYears(found)
        setCopyYear((prev) => (prev !== "" && found.includes(prev) ? prev : found[0] ?? ""))
      })
      .catch((err) => {
        if (!cancelled) {
          setSnackbar({
            children: errorMessage(err, "Failed to load production camp years"),
            severity: "error",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [isTestData, setSnackbar])

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

  const loadBypass = React.useCallback(
    async (year: number | null) => {
      if (year === null) {
        setBypassEmails([])
        return
      }
      setBypassLoading(true)
      try {
        const snapshot = await getDocs(
          collection(firestore, registrationBypassCollectionPath(year))
        )
        setBypassEmails(snapshot.docs.map((d) => d.id).sort())
      } catch (err) {
        setSnackbar({
          children: errorMessage(err, "Failed to load bypass emails"),
          severity: "error",
        })
        setBypassEmails([])
      } finally {
        setBypassLoading(false)
      }
    },
    [firestore, setSnackbar]
  )

  React.useEffect(() => {
    loadBypass(selectedYear)
  }, [loadBypass, selectedYear])

  // Reset the form whenever a different year (or a fresh copy of it) arrives,
  // but never over the admin's unsaved edits.
  React.useEffect(() => {
    if (campLoading || bypassLoading || dirty) return
    setForm(formFromCampYear(camp, bypassEmails))
  }, [camp, campLoading, bypassEmails, bypassLoading, dirty])

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
      async () => {
        setDirty(false)
        await loadBypass(selectedYear)
      }
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

  const handleCopyYearFromProd = () => {
    if (copyYear === "") return
    const year = copyYear
    run(
      "Copy from production",
      { action: "copyYearFromProd", year },
      `Copied camps/${year} and its bypass list from production into the test database`,
      async () => {
        await loadYears()
        setDirty(false)
        setSelectedYear(year)
        await loadBypass(year)
      }
    )
  }

  const handleCopySiteConfigFromProd = () => {
    run(
      "Copy site pointers from production",
      { action: "copySiteConfigFromProd" },
      "Copied the current and pre-registration years from production into the test database"
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

  const disabled =
    busy !== null || selectedYear === null || campLoading || bypassLoading

  return (
    <Stack spacing={3} sx={{ maxWidth: 900, mx: "auto", py: 2 }}>
      <Typography variant="h5">Camp Year</Typography>

      <Alert severity={isTestData ? "warning" : "info"}>
        Editing the {isTestData ? "test" : "production"} database. Current camp
        year: <b>{currentCampYear ?? "not set"}</b>. Pre-registration year:{" "}
        <b>{preRegistrationCampYear ?? "not set"}</b>.
      </Alert>

      {isTestData && (
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="body2" color="text.secondary">
            Mirror production into the test database:
          </Typography>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Production year</InputLabel>
            <Select
              value={copyYear}
              label="Production year"
              onChange={(e) => setCopyYear(Number(e.target.value))}
              disabled={busy !== null || prodYears.length === 0}
            >
              {prodYears.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                  {years.includes(y) ? " (overwrites test copy)" : " (not in test yet)"}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            color="warning"
            onClick={handleCopyYearFromProd}
            disabled={busy !== null || copyYear === ""}
          >
            {busy === "Copy from production" ? (
              <CircularProgress size={20} />
            ) : (
              `Copy ${copyYear || "year"} from production`
            )}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={handleCopySiteConfigFromProd}
            disabled={busy !== null}
          >
            Copy site pointers from production
          </Button>
        </Stack>
      )}

      {years.length === 0 ? (
        <Alert severity="error">
          No camps/&#123;year&#125; documents exist in this database. Seed one
          with scripts/src/resetCampYearInfo.ts, then manage it here.
        </Alert>
      ) : (
        <>
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
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

          {campLoading || bypassLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={3}>
              <Divider textAlign="left">Details</Divider>
              <Grid container spacing={2}>
                {DETAIL_TEXT_KEYS.map((key) => {
                  const error = textFieldError(key, form.texts[key])
                  return (
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
                        error={error !== undefined}
                        helperText={error ?? TEXT_HELP[key]}
                        fullWidth
                        size="small"
                      />
                    </Grid>
                  )
                })}
              </Grid>

              <Divider textAlign="left">Images</Divider>
              <Grid container spacing={2}>
                {CAMP_YEAR_IMAGE_URL_KEYS.map((key) => {
                  const value = form.texts[key]
                  const valid = value.trim() === "" || isAllowedImageUrl(value.trim())
                  return (
                    <Grid key={key} size={{ xs: 12, md: 6 }}>
                      <Stack spacing={1}>
                        <TextField
                          label={TEXT_LABELS[key]}
                          type="url"
                          placeholder="https://…"
                          inputProps={{ maxLength: MAX_IMAGE_URL_LENGTH }}
                          value={value}
                          onChange={(e) =>
                            update((prev) => ({
                              ...prev,
                              texts: { ...prev.texts, [key]: e.target.value },
                            }))
                          }
                          error={!valid}
                          helperText={
                            valid ? IMAGE_HELP[key] : IMAGE_URL_ERROR
                          }
                          fullWidth
                          size="small"
                        />
                        {valid && value.trim() !== "" && (
                          <Box
                            component="img"
                            src={value.trim()}
                            alt={`${TEXT_LABELS[key]} preview`}
                            referrerPolicy="no-referrer"
                            sx={{
                              display: "block",
                              maxWidth: 1,
                              maxHeight: 160,
                              objectFit: "contain",
                              borderRadius: 1,
                              border: 1,
                              borderColor: "divider",
                            }}
                          />
                        )}
                      </Stack>
                    </Grid>
                  )
                })}
              </Grid>

              <Divider textAlign="left">Display toggles</Divider>
              <Grid container spacing={2}>
                {CAMP_YEAR_FLAG_KEYS.map((key) => (
                  <Grid key={key} size={{ xs: 12, md: 4 }}>
                    <FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.flags[key]}
                            onChange={(e) =>
                              update((prev) => ({
                                ...prev,
                                flags: {
                                  ...prev.flags,
                                  [key]: e.target.checked,
                                },
                              }))
                            }
                          />
                        }
                        label={FLAG_LABELS[key].label}
                      />
                      <FormHelperText sx={{ mx: 0 }}>
                        {FLAG_LABELS[key].help}
                      </FormHelperText>
                    </FormControl>
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
                Stored privately per email: a parent can see only their own
                entry, never the list.
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
                    setForm(formFromCampYear(camp, bypassEmails))
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
