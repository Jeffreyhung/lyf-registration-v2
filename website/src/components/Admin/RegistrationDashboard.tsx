import * as React from "react"
import {
  Box,
  Button,
  Card,
  CardHeader,
  IconButton,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material"
import { HelpOutline } from "@mui/icons-material"
import {
  GridColDef,
  GridCsvExportOptions,
  GridRowModel,
  GridSlotProps,
  GridToolbarContainer,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
  GridToolbarDensitySelector,
  GridToolbarExportContainer,
  GridToolbarQuickFilter,
  GridPrintExportMenuItem,
  GridRowSelectionModel,
  useGridApiContext,
} from "@mui/x-data-grid"
import { getDoc, serverTimestamp, updateDoc } from "firebase/firestore"
import dayjs from "dayjs"

import {
  RegistrationData,
  getParentNames,
  getParentEmails,
  getParentPhoneNumbers,
} from "@hooks/useRegistrations"
import { Table, DataGridColumnAlign } from "@components/Table"
import {
  AdminRole,
  RegistrationStatus,
  roleHasCapability,
} from "lyf-registration-schemas"

// Utils
import { Payment } from "@utils/databaseSchema"

import CancelStatusDialog, {
  CancelStatusPromise,
  RowWithStatusAndNotes,
} from "./CancelStatusDialog"
import useFilterRegistrationStatus from "@hooks/useFilterRegistrationStatus"

import CopyToClipboardButton from "./CopyToClipboardButton"
import RefundDialog from "@components/Dialog/RefundDialog"

type RegistrationDashboardProps = {
  data: RegistrationData[]
  loading: boolean
  campYear: number
  adminRole: AdminRole | null
}

export interface RegDashboardRow extends RowWithStatusAndNotes {
  name: string
  preferredName: string
  grade: number
  status: string
  gender: string
  pronouns: string
  shirtSize: string
  medicalConditions: string
  dietAndFoodAllergies: string
  isPreRegistered: boolean
  isReturning: boolean
  parentNames: string
  parentEmails: string
  // Account emails on the family document (Family.emails). Usually the same
  // as parentEmails, but it is the list the old export scripts used.
  familyEmails: string
  // Family mailing address.
  street: string
  suite: string
  city: string
  state: string
  zip: string
  country: string
  // Household culture survey answers (Family.household).
  householdCamperMessage: string
  householdLanguageFrequency: string
  householdCultureConfidence: string
  householdCultureLearn: string
  householdCultureBarrier: string
  householdCultureLesson: string
  createdAt: Date
  internalNotes: string
}

const HEALTH_FIELDS = new Set(["medicalConditions", "dietAndFoodAllergies"])

// Columns that are hidden until picked from the toolbar's Columns menu.
// They are still exported by the "all columns" CSV option. Keeping them out of
// the default view is what keeps the grid readable; the address and household
// columns exist for exports (mailing lists), not for day-to-day browsing.
const ADDRESS_COLUMNS: GridColDef[] = [
  { field: "street", headerName: "Street", minWidth: 150, flex: 0.5 },
  { field: "suite", headerName: "Suite / Apt", width: 100 },
  { field: "city", headerName: "City", minWidth: 120, flex: 0.25 },
  { field: "state", headerName: "State", width: 80 },
  { field: "zip", headerName: "Zip", width: 90 },
  { field: "country", headerName: "Country", width: 100 },
].map((col) => ({ ...col, type: "string", ...DataGridColumnAlign }))

const HOUSEHOLD_COLUMNS: GridColDef[] = [
  {
    field: "householdLanguageFrequency",
    headerName: "Household: Language Frequency",
  },
  {
    field: "householdCultureConfidence",
    headerName: "Household: Culture Confidence",
  },
  { field: "householdCultureLearn", headerName: "Household: Culture to Learn" },
  {
    field: "householdCultureBarrier",
    headerName: "Household: Culture Barriers",
  },
  { field: "householdCultureLesson", headerName: "Household: Culture Lesson" },
  { field: "householdCamperMessage", headerName: "Household: Camper Message" },
].map((col) => ({
  ...col,
  type: "string",
  minWidth: 150,
  flex: 0.5,
  ...DataGridColumnAlign,
}))

const HIDDEN_BY_DEFAULT = [
  "createdAt",
  "isReturning",
  "familyEmails",
  ...ADDRESS_COLUMNS.map((col) => col.field),
  ...HOUSEHOLD_COLUMNS.map((col) => col.field),
]

const allColumns: GridColDef[] = [
  {
    field: "name",
    headerName: "Name",
    minWidth: 130,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "preferredName",
    headerName: "Preferred Name",
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "grade",
    headerName: "Grade",
    type: "number",
    width: 75,
    ...DataGridColumnAlign,
  },
  {
    field: "birthDate",
    headerName: "Birthday",
    type: "date",
    width: 100,
    ...DataGridColumnAlign,
  },
  {
    field: "status",
    headerName: "Status",
    width: 100,
    type: "singleSelect",
    editable: true,
    valueOptions: Object.values(RegistrationStatus),
    ...DataGridColumnAlign,
  },
  {
    field: "gender",
    headerName: "Gender",
    width: 100,
    ...DataGridColumnAlign,
  },
  {
    field: "pronouns",
    headerName: "Pronouns",
    width: 100,
    ...DataGridColumnAlign,
  },
  {
    field: "shirtSize",
    headerName: "Shirt Size",
    width: 75,
    ...DataGridColumnAlign,
  },
  {
    field: "medicalConditions",
    headerName: "Medical Conditions",
    type: "string",
    minWidth: 150,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "dietAndFoodAllergies",
    headerName: "Diet and Food Allergies",
    type: "string",
    minWidth: 150,
    maxWidth: 175,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "cabinPreference",
    headerName: "Cabin Preference",
    type: "string",
    minWidth: 150,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "isPreRegistered",
    headerName: "Pre-Registered",
    type: "boolean",
    width: 20,
    ...DataGridColumnAlign,
  },
  {
    field: "isReturning",
    headerName: "Returning Camper",
    type: "boolean",
    width: 20,
    ...DataGridColumnAlign,
  },
  {
    field: "parentNames",
    headerName: "Parent Names",
    type: "string",
    minWidth: 150,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "parentEmails",
    headerName: "Parent Emails",
    type: "string",
    minWidth: 150,
    flex: 1,
    ...DataGridColumnAlign,
  },
  {
    field: "parentPhoneNumbers",
    headerName: "Parent Phone Numbers",
    type: "string",
    minWidth: 150,
    flex: 1,
    ...DataGridColumnAlign,
  },
  {
    field: "familyEmails",
    headerName: "Family Account Emails",
    type: "string",
    minWidth: 150,
    flex: 1,
    ...DataGridColumnAlign,
  },
  ...ADDRESS_COLUMNS,
  ...HOUSEHOLD_COLUMNS,
  {
    field: "createdAt",
    headerName: "Created At",
    type: "dateTime",
    width: 175,
    ...DataGridColumnAlign,
  },
  {
    field: "internalNotes",
    headerName: "Notes",
    editable: true,
    flex: 1,
    headerAlign: "center",
  },
]

function getColumnsForRole(role: AdminRole | null): GridColDef[] {
  const canSeeHealth = roleHasCapability(role, "readHealth")
  if (canSeeHealth) return allColumns
  return allColumns.filter((col) => !HEALTH_FIELDS.has(col.field))
}

type CsvExportMenuItemProps = {
  label: string
  options: GridCsvExportOptions
  // Injected by GridToolbarExportContainer.
  hideMenu?: () => void
}

// Same as the grid's built-in CSV menu item, but with our own label so the
// menu can offer both a "visible columns" and an "all columns" download.
function CsvExportMenuItem({
  label,
  options,
  hideMenu,
}: CsvExportMenuItemProps) {
  const apiRef = useGridApiContext()
  return (
    <MenuItem
      onClick={() => {
        apiRef.current.exportDataAsCsv(options)
        hideMenu?.()
      }}
    >
      {label}
    </MenuItem>
  )
}

const EXPORT_WORKFLOWS: [string, string][] = [
  [
    "Mailing addresses",
    "Keep the status filter on Active, then Export → CSV (all columns), or turn on the address columns under Columns and export visible columns.",
  ],
  [
    "Pre-registered emails",
    "Open Filters and set Pre-Registered to yes, then Export, or use Copy Parent Emails above for a one-per-line list.",
  ],
  [
    "Emails for specific campers",
    "Type part of a camper name in the search box to narrow the grid, then Export or copy.",
  ],
]

function ExportHelp() {
  return (
    <Tooltip
      enterTouchDelay={0}
      leaveTouchDelay={10000}
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="subtitle2" gutterBottom>
            Exporting from this grid
          </Typography>
          <Typography variant="caption" component="p" sx={{ mb: 1 }}>
            Exports include only the rows that match the status filter, the grid
            filters and the search box, on every page. If any rows are checked,
            only those rows are exported.
          </Typography>
          {EXPORT_WORKFLOWS.map(([title, steps]) => (
            <Typography
              key={title}
              variant="caption"
              component="p"
              sx={{ mb: 0.5 }}
            >
              <strong>{title}:</strong> {steps}
            </Typography>
          ))}
        </Box>
      }
    >
      <IconButton size="small" aria-label="How to export registrations">
        <HelpOutline fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}

export default function RegistrationDashboard({
  data,
  loading,
  campYear,
  adminRole,
}: RegistrationDashboardProps) {
  const columns = React.useMemo(() => getColumnsForRole(adminRole), [adminRole])
  const [filteredData, selectComponent] = useFilterRegistrationStatus(data, [
    RegistrationStatus.ACTIVE,
  ])
  const registrationData = filteredData.sort((a, b) =>
    a.status.localeCompare(b.status)
  )

  const [rowSelection, setRowSelection] = React.useState<GridRowSelectionModel>(
    []
  )
  const [refundDialogOpen, setRefundDialogOpen] = React.useState<boolean>(false)
  const [refundPayments, setRefundPayments] = React.useState<
    Map<RegistrationData, Payment[]>
  >(new Map())
  const [cancelPromiseContext, setCancelPromiseContext] =
    React.useState<CancelStatusPromise | null>(null)

  const rows: RegDashboardRow[] = registrationData.map((reg, index) => ({
    id: index.toString(),
    index: index + 1,
    name: reg.camperName,
    preferredName: reg.preferredName || "",
    grade: reg.grade,
    status: reg.status,
    birthDate: dayjs(reg.birthDate ?? "").toDate(),
    isPreRegistered: reg.isPreRegistered,
    gender: reg.gender?.join(", ") || "",
    pronouns: reg.pronouns || "",
    shirtSize: reg.shirtSize || "",
    medicalConditions: reg.medicalConditions || "",
    dietAndFoodAllergies: reg.dietAndFoodAllergies || "",
    cabinPreference: reg.cabinPreference || "",
    isReturning: !!reg.isReturning,

    // Join the parent's names if they exist.
    parentNames: getParentNames(reg),
    // Join the parent's emails if they exist.
    parentEmails: getParentEmails(reg),
    // Join the parent's phone numbers if they exist.
    parentPhoneNumbers: getParentPhoneNumbers(reg),

    familyEmails: (reg.familyData?.emails ?? []).join(", "),
    street: reg.familyData?.street ?? "",
    suite: reg.familyData?.suite ?? "",
    city: reg.familyData?.city ?? "",
    state: reg.familyData?.state ?? "",
    zip: reg.familyData?.zip ?? "",
    country: reg.familyData?.country ?? "",
    householdCamperMessage: reg.familyData?.household?.camperMessage ?? "",
    householdLanguageFrequency:
      reg.familyData?.household?.languageFrequency ?? "",
    householdCultureConfidence:
      reg.familyData?.household?.cultureConfidence ?? "",
    householdCultureLearn: reg.familyData?.household?.cultureLearn ?? "",
    householdCultureBarrier: reg.familyData?.household?.cultureBarrier ?? "",
    householdCultureLesson: reg.familyData?.household?.cultureLesson ?? "",

    internalNotes: reg.internalNotes,
    createdAt: reg.createdAt.toDate(),
  }))

  const updateRow = async (newRow: RegDashboardRow) => {
    const registrationRef = registrationData[newRow.index - 1].registrationRef
    await updateDoc(registrationRef, {
      status: newRow.status,
      internalNotes: newRow.internalNotes ?? null,
      updatedAt: serverTimestamp(),
    })
  }

  const copyEmails = () => {
    const parentEmails = new Set<string>()
    // Each row has parent emails already joined together, so we need to split them back out.
    rows.forEach((r) =>
      r.parentEmails.split(", ").forEach((email) => parentEmails.add(email))
    )

    return Array.from(parentEmails.values()).join("\n")
  }

  const copyParentContactInfo = () => {
    const parentContactInfo = new Set<string>()
    registrationData.forEach((reg) => {
      reg.parents.forEach((p) => {
        const { email, firstName, lastName } = p

        // If there's no email then no need to add an entry.
        if (!email) {
          return
        }

        // Email, First Name, Last Name all tab separated
        parentContactInfo.add(
          [email, firstName ?? "", lastName ?? ""].join("\t")
        )
      })
    })

    return Array.from(parentContactInfo.values()).join("\n")
  }

  const updateRowPromise = async (
    newRow: GridRowModel<RegDashboardRow>,
    oldRow: GridRowModel<RegDashboardRow>
  ) =>
    new Promise<RegDashboardRow>((resolve, reject) => {
      if (
        newRow.status === oldRow.status &&
        newRow.internalNotes === oldRow.internalNotes
      ) {
        // Nothing changed so just resolve
        resolve(newRow)
        return
      }

      if (newRow.status === RegistrationStatus.CANCELLED) {
        setCancelPromiseContext({
          newRow,
          oldRow,
          resolve,
          reject,
        })
      } else {
        updateRow(newRow)
          .then(() => resolve(newRow))
          .catch((e) => reject(new Error(`Failed to update row.: ${e}`)))
      }
    })

  // e.g. 2026-lyf-registrations-2026-10-27 (.csv is appended by the grid).
  const exportFileName = `${campYear}-lyf-registrations-${dayjs().format(
    "YYYY-MM-DD"
  )}`

  const toolbar = (props: GridSlotProps["toolbar"]) => {
    const { rowSelection } = props

    return (
      <GridToolbarContainer>
        <GridToolbarColumnsButton />
        <GridToolbarFilterButton />
        <GridToolbarDensitySelector />
        <GridToolbarExportContainer>
          <CsvExportMenuItem
            label="Download as CSV (visible columns)"
            options={{ fileName: exportFileName, utf8WithBom: true }}
          />
          <CsvExportMenuItem
            label="Download as CSV (all columns)"
            options={{
              fileName: `${exportFileName}-all-columns`,
              allColumns: true,
              utf8WithBom: true,
            }}
          />
          <GridPrintExportMenuItem options={{ fileName: exportFileName }} />
        </GridToolbarExportContainer>
        <ExportHelp />
        <GridToolbarQuickFilter debounceMs={300} />
        <Box sx={{ flexGrow: 1 }} />
        {roleHasCapability(adminRole, "managePayments") && (
          <Button
            onClick={async () => {
              const paymentMap: [RegistrationData, Payment[]][] =
                await Promise.all(
                  rowSelection.map(async (rowId) => {
                    const registration = registrationData[rows[rowId].index - 1]
                    const payments = await Promise.all(
                      !registration.payments
                        ? []
                        : registration.payments.map(async (p) => ({
                            ...(await getDoc(p)).data(),
                            ref: p,
                            id: p.id,
                          }))
                    )
                    return [registration, payments]
                  })
                )
              setRefundPayments(new Map(paymentMap))
              setRefundDialogOpen(true)
            }}
            onMouseDown={(e: React.MouseEvent) => {
              // Prevents moving focus away from other elements
              e.preventDefault()
            }}
            disabled={rowSelection.length === 0}
            variant="outlined"
          >
            Refund
          </Button>
        )}
      </GridToolbarContainer>
    )
  }

  return (
    <>
      <Card>
        <CardHeader
          title={`${campYear} LYF Camp Registrations`}
          titleTypographyProps={{
            align: "center",
            variant: "h4",
          }}
        />
        <RefundDialog
          refundPayments={refundPayments}
          open={refundDialogOpen}
          setOpen={(b) => setRefundDialogOpen(b)}
        ></RefundDialog>
        {selectComponent}
        <Stack direction="row" sx={{ padding: 1 }} spacing={2}>
          <CopyToClipboardButton processDataFunc={copyEmails}>
            Copy Parent Emails to Clipboard
          </CopyToClipboardButton>
          <CopyToClipboardButton processDataFunc={copyParentContactInfo}>
            Copy Parent Contact Info to Clipboard
          </CopyToClipboardButton>
        </Stack>
        <Table
          rows={rows}
          columns={columns}
          loading={loading}
          pageSize={100}
          updateRow={updateRowPromise}
          hiddenColumns={HIDDEN_BY_DEFAULT}
          toolbar={toolbar}
          rowSelectionModel={rowSelection}
          setRowSelectionModel={setRowSelection}
        />
      </Card>
      <CancelStatusDialog
        context={cancelPromiseContext}
        setContext={setCancelPromiseContext}
        updateRow={updateRow}
      />
    </>
  )
}
