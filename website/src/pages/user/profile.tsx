import React from "react"
import { PageProps } from "gatsby"
import dayjs from "dayjs"
import { doc, setDoc, updateDoc } from "firebase/firestore"
import { Box, Chip, Stack, Tooltip, Typography, useTheme } from "@mui/material"
import {
  DataGrid,
  GridColumnVisibilityModel,
  GridColDef,
  GridRenderCellParams,
  GridToolbar,
  GridActionsCellItem,
  GridRowEditStopReasons,
  GridRowId,
  GridRowModes,
  GridRowModesModel,
} from "@mui/x-data-grid"
import EditIcon from "@mui/icons-material/Edit"
import RestoreIcon from "@mui/icons-material/Restore"
import SaveIcon from "@mui/icons-material/Save"

// Utils
import getPageTitle from "@utils/getPageTitle"
import AuthContext from "@components/Auth/AuthContext"
import ProdContext from "@components/ProdContext"

// Components
import PrivateRoute from "@components/Auth/PrivateRoute"
import { Section } from "@components/Layout"
import { SnackbarAlertProvider } from "@components/SnackbarAlert"
import useFamilyData from "@hooks/useFamilyData"
import useSiteConfig from "@hooks/useSiteConfig"
import { CampTrack, RegistrationStatus } from "lyf-registration-schemas"
import { DataGridColumnAlign } from "@components/Table"
import { OffWaitlistDialog } from "@components/Profile"
import useCampSchedule from "@hooks/useCampSchedule"

export type ParentDashboardRow = {
  registrationId: string
  camperId: string
  year: string
  firstName: string
  name: string
  gender: string
  birthday: string
  grade: number
  shirtSize: string
  dietAndFoodAllergies: string
  medicalConditions: string
  createdAt: string | Date
  campTrack: CampTrack | "N/A"
  status: (number | RegistrationStatus | CampTrack)[]
  isPreRegistered: boolean
}

const columns: GridColDef[] = [
  {
    field: "year",
    headerName: "Year",
    minWidth: 50,
    maxWidth: 755,
    ...DataGridColumnAlign,
  },
  {
    field: "name",
    headerName: "Camper Name",
    minWidth: 130,
    maxWidth: 250,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "gender",
    headerName: "Gender",
    minWidth: 130,
    maxWidth: 200,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "birthday",
    headerName: "Birthday",
    width: 100,
    ...DataGridColumnAlign,
  },
  {
    field: "grade",
    headerName: "Grade",
    width: 75,
    type: "singleSelect",
    valueOptions: [...Array(13).keys()].filter((g) => g >= 4),
    ...DataGridColumnAlign,
  },
  {
    field: "createdAt",
    headerName: "Created At",
    type: "dateTime",
    minWidth: 100,
    width: 150,
    flex: 0.5,
    ...DataGridColumnAlign,
  },
  {
    field: "campTrack",
    headerName: "Camp Track",
    type: "string",
    minWidth: 100,
    maxWidth: 100,
    ...DataGridColumnAlign,
  },
  {
    field: "status",
    headerName: "Status",
    renderCell: (
      params: GridRenderCellParams<
        ParentDashboardRow,
        [RegistrationStatus, number | null, CampTrack]
      >
    ) => {
      const [status, , campTrack] = params.value

      const chipColor = (() => {
        switch (status) {
          case RegistrationStatus.ACTIVE:
            return "primary"
          case RegistrationStatus.CANCELLED:
            return "secondary"
          default:
            return "default"
        }
      })()

      return (
        <Stack sx={{ padding: 1.2 }}>
          <Chip
            label={
              status !== RegistrationStatus.WAITLIST
                ? status
                : `Waitlist for ${campTrack} camp track`
            }
            color={chipColor}
            size="medium"
            sx={{ width: 1 }}
          />
        </Stack>
      )
    },
    minWidth: 200,
    maxWidth: 400,
    flex: 0.8,
    ...DataGridColumnAlign,
  },
  {
    field: "isPreRegistered",
    headerName: "Pre-Registered",
    type: "boolean",
    minWidth: 50,
    width: 135,
  },
]

// Which document each editable column is stored on
const REGISTRATION_FIELDS = new Set(["shirtSize"])
const HEALTH_FIELDS = new Set(["dietAndFoodAllergies", "medicalConditions"])

const editableColumns: GridColDef[] = [
  {
    field: "shirtSize",
    headerName: "T-Shirt Size",
    width: 100,
    type: "singleSelect",
    valueOptions: ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
    headerClassName: "editable--header",
    ...DataGridColumnAlign,
  },
  {
    field: "dietAndFoodAllergies",
    headerName: "Diet/Food Allergy",
    minWidth: 150,
    maxWidth: 250,
    flex: 0.5,
    headerClassName: "editable--header",
    ...DataGridColumnAlign,
  },
  {
    field: "medicalConditions",
    headerName: "Medical Conditions",
    minWidth: 150,
    maxWidth: 250,
    flex: 0.5,
    headerClassName: "editable--header",
    ...DataGridColumnAlign,
  },
]

// Previous-year grid: read-only, so its columns never change.
const previousColumns: GridColDef[] = columns.concat(editableColumns)

const ProfilePage: React.FC<PageProps> = () => {
  const { isSignedIn, user } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  // "Current" means the camp year the site is registering for (config/site),
  // which stops matching the calendar year once the rollover happens. The
  // calendar year is only a fallback for a missing config/site document.
  // Family data is not requested until config resolves, so the hook's
  // per-year registration listener is created once, for the right year.
  const { currentCampYear, loading: configLoading } = useSiteConfig()
  const currentYear = currentCampYear ?? dayjs().year()
  const [familyData, loading, _] = useFamilyData({
    isSignedIn: isSignedIn && !configLoading,
    user,
    campYear: currentYear.toString(),
    firestore,
    includeWaitlistPosition:
      useCampSchedule(currentYear).campInfo?.showWaitlistPosition === true, // camps/{year}.showWaitlistPosition (Camp Year tab); off since 2026
  })
  // Rows are rebuilt only when the family data changes; the grids below
  // otherwise re-render (edit mode, column menus) with the same inputs.
  const campers = React.useMemo(
    () => new Map(familyData.campers.map((c) => [c.ref.path, c])),
    [familyData.campers]
  )
  const theme = useTheme()
  const [shouldShowOffWaitlistDialog, setShouldShowOffWaitlistDialog] =
    React.useState(false)

  const getRowsForYear = React.useCallback(
    (lowerBound: number, upperBound: number) => {
      const rows: ParentDashboardRow[] = Array.from(familyData.registrations)
        .filter(([, reg]) => {
          const year = parseInt(reg.campYear)
          return year >= lowerBound && year <= upperBound
        })
        .map(([, reg], index) => {
          const camper = campers.get(reg.camper.path)
          return {
            id: index.toString(),
            registrationId: reg.ref.path,
            camperId: camper.ref.path,
            year: reg.campYear,
            firstName: camper.firstName ?? "",
            name: `${camper.firstName} ${camper.lastName}`,
            gender: camper.gender?.join(", ") || "",
            birthday: camper.birthDate,
            grade: reg.grade,
            shirtSize: reg.shirtSize || "",
            dietAndFoodAllergies: camper.health?.dietAndFoodAllergies || "",
            medicalConditions: camper.health?.medicalConditions || "",
            createdAt: reg.createdAt?.toDate() || "",
            campTrack: reg.campTrack || "N/A",
            status: [reg.status, reg.waitlistPosition, reg.campTrack],
            isPreRegistered: reg.isPreRegistered ?? false,
          }
        })
      return rows
    },
    [familyData.registrations, campers]
  )

  const curRows = React.useMemo(
    () => getRowsForYear(currentYear, currentYear),
    [getRowsForYear, currentYear]
  )
  const prevRows = React.useMemo(
    () => getRowsForYear(dayjs(0).year(), currentYear - 1),
    [getRowsForYear, currentYear]
  )

  // Keep track of all the campers from this year who have been moved off the waitlist
  // and Pending Payment.
  const pendingPaymentRows = React.useMemo(
    () =>
      curRows.filter(
        (reg) => reg.status[0] === RegistrationStatus.PENDING_PAYMENT
      ),
    [curRows]
  )

  React.useEffect(() => {
    setShouldShowOffWaitlistDialog(pendingPaymentRows.length > 0)
  }, [pendingPaymentRows])

  const [columnVisibilityModel, setColumnVisibilityModel] =
    React.useState<GridColumnVisibilityModel>({
      year: false,
      shirtSize: true,
      gender: false,
      birthday: false,
      createdAt: false,
      dietAndFoodAllergies: false,
      medicalConditions: false,
    })

  const [prevColumnVisibilityModel, setPrevColumnVisibilityModel] =
    React.useState<GridColumnVisibilityModel>({
      year: true,
      shirtSize: false,
      gender: false,
      birthday: false,
      createdAt: false,
      dietAndFoodAllergies: false,
      medicalConditions: false,
    })

  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>(
    {}
  )

  const processRowUpdate = async (
    newRow: ParentDashboardRow,
    oldRow: ParentDashboardRow
  ): Promise<ParentDashboardRow> => {
    const registration = familyData.registrations.get(newRow.registrationId)
    const camper = campers.get(newRow.camperId)
    const registrationUpdate: [string, unknown][] = []
    const healthUpdate: [string, unknown][] = []
    const camperUpdate: [string, unknown][] = []

    setSaving(true)
    editableColumns.forEach((column) => {
      const field = column.field as keyof ParentDashboardRow
      if (newRow[field] === oldRow[field]) return
      if (REGISTRATION_FIELDS.has(field)) {
        registrationUpdate.push([field, newRow[field]])
      } else if (HEALTH_FIELDS.has(field)) {
        healthUpdate.push([field, newRow[field]])
      } else {
        camperUpdate.push([field, newRow[field]])
      }
    })
    if (registrationUpdate.length > 0) {
      await updateDoc(registration.ref, Object.fromEntries(registrationUpdate))
    }
    if (healthUpdate.length > 0) {
      // Health is role-gated in its own sub-document, never on the camper doc
      await setDoc(
        doc(firestore, `${camper.ref.path}/private/health`),
        Object.fromEntries(healthUpdate),
        { merge: true }
      )
    }
    if (camperUpdate.length > 0) {
      await updateDoc(camper.ref, Object.fromEntries(camperUpdate))
    }
    setSaving(false)
    return newRow
  }

  // The actions column closes over the row-mode model, so the column list
  // for the current-year grid changes only when a row enters or leaves edit
  // mode rather than on every render.
  const currentColumns: GridColDef[] = React.useMemo(() => {
    const handleEditClick = (id: GridRowId) => () => {
      setEditing(true)
      setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.Edit } })
    }
    const handleCancelClick = (id: GridRowId) => () => {
      setEditing(false)
      setRowModesModel({
        ...rowModesModel,
        [id]: { mode: GridRowModes.View, ignoreModifications: true },
      })
    }
    const handleConfirmClick = (id: GridRowId) => () => {
      setEditing(false)
      setRowModesModel({ ...rowModesModel, [id]: { mode: GridRowModes.View } })
    }

    const actions: GridColDef = {
      field: "actions",
      headerName: "Actions",
      type: "actions",
      width: 85,
      getActions: ({ id }) =>
        rowModesModel[id]?.mode === GridRowModes.Edit
          ? [
              <Tooltip key="save" title="Save" disableInteractive>
                <GridActionsCellItem
                  icon={<SaveIcon />}
                  label="Save"
                  onClick={handleConfirmClick(id)}
                />
              </Tooltip>,
              <Tooltip key="restore" title="Restore" disableInteractive>
                <GridActionsCellItem
                  icon={<RestoreIcon />}
                  label="Restore"
                  onClick={handleCancelClick(id)}
                />
              </Tooltip>,
            ]
          : [
              <Tooltip key="edit" title="Edit" disableInteractive>
                <GridActionsCellItem
                  icon={<EditIcon />}
                  label="Edit"
                  onClick={handleEditClick(id)}
                />
              </Tooltip>,
            ],
    }

    return columns
      .concat(actions)
      .concat(editableColumns.map((c) => ({ ...c, editable: true })))
  }, [rowModesModel])

  // Query

  // For every user we have an email that we'll use to see what family they're part of.
  // Then, we can see all of the parents and campers registered.
  // From the campers, we can then see all past registered camps.

  // This page will consist of a grid of parent profiles and a grid of camper profiles.
  // Then it will show a table of all previous registrations along with status.
  // TODO: Add a cancel option for parents
  // Need to start tracking transaction information too maybe?

  return (
    <SnackbarAlertProvider>
      <PrivateRoute>
        <Section sx={{ height: "85vh", width: "xl" }}>
          <Typography variant="h3" textAlign="center">
            Registration Dashboard
          </Typography>
          <Typography variant="h5" sx={{ padding: "4% 0 1% 0" }}>
            {currentYear} Current Registrations
          </Typography>
          <Box
            sx={{
              "& .editable--header": {
                backgroundColor: editing
                  ? theme.palette.primary.light
                  : "#FFFFFF",
              },
            }}
          >
            <DataGrid
              rows={curRows}
              columns={currentColumns}
              loading={configLoading || loading || saving}
              editMode="row"
              rowModesModel={rowModesModel}
              onRowModesModelChange={(m) => setRowModesModel(m)}
              onRowEditStop={(p, e) => {
                /*
                 * Prevents reverting from Edit -> View mode
                 * when focus leaves the row (e.g. clicking away)
                 */
                if (p.reason === GridRowEditStopReasons.rowFocusOut) {
                  e.defaultMuiPrevented = true
                }
              }}
              disableRowSelectionOnClick
              processRowUpdate={processRowUpdate}
              initialState={{
                pagination: {
                  paginationModel: {
                    pageSize: 20,
                  },
                },
              }}
              slots={{ toolbar: GridToolbar }}
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={(m) => setColumnVisibilityModel(m)}
              sx={{
                padding: 1,
                borderRadius: "25px",
                boxShadow: "6px 6px 0px #FFC3DA",
              }}
            />
          </Box>

          <Typography variant="h5" sx={{ padding: "4% 0 1% 0" }}>
            Previous Registrations
          </Typography>
          <Box>
            <DataGrid
              rows={prevRows}
              columns={previousColumns}
              loading={configLoading || loading || saving}
              initialState={{
                pagination: {
                  paginationModel: {
                    pageSize: 20,
                  },
                },
              }}
              disableRowSelectionOnClick
              slots={{ toolbar: GridToolbar }}
              columnVisibilityModel={prevColumnVisibilityModel}
              onColumnVisibilityModelChange={(m) =>
                setPrevColumnVisibilityModel(m)
              }
              sx={{
                padding: 1,
                borderRadius: "25px",
                boxShadow: "6px 6px 0px #FFE6A7",
              }}
            />
          </Box>
        </Section>

        <OffWaitlistDialog
          shouldShowDialog={shouldShowOffWaitlistDialog}
          camperNames={pendingPaymentRows.map((row) => row.firstName)}
        />
      </PrivateRoute>
    </SnackbarAlertProvider>
  )
}

export default ProfilePage

export const Head = getPageTitle("Profile")
