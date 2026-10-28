import * as React from "react"
import {
  Alert,
  Box,
  Container,
  Grid,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
  useMediaQuery,
} from "@mui/material"
import PeopleOutlinedIcon from "@mui/icons-material/PeopleOutlined"
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined"
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined"
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined"
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined"
import RedeemOutlinedIcon from "@mui/icons-material/RedeemOutlined"
import Diversity3OutlinedIcon from "@mui/icons-material/Diversity3Outlined"
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import EventOutlinedIcon from "@mui/icons-material/EventOutlined"
import { DatePicker } from "@mui/x-date-pickers/DatePicker"
import dayjs from "dayjs"
import { Capability, roleHasCapability } from "lyf-registration-schemas"

import AuthContext from "@components/Auth/AuthContext"
import { LinkButton } from "@components/Button"
import { ProdContext } from "@components/ProdContext"
import {
  Demographics,
  PendingPayments,
  RegistrationDashboard,
  Waitlist,
  CamperCheckout,
  CreateTestData,
} from "@components/Admin"
import { SmallGroupAssignmentsV2 } from "@components/SmallGroupAndCabinAssignments"
import useRegistrations from "@hooks/useRegistrations"
import useSiteConfig from "@hooks/useSiteConfig"
import getPageTitle from "@utils/getPageTitle"
import { SnackbarAlertProvider } from "@components/SnackbarAlert"
import PaymentDashboard from "@components/Admin/PaymentDashboard"
import CampCreditTab from "@components/Admin/CampCreditTab"
import AdminManagement from "@components/Admin/AdminManagement"
import CampYearTab from "@components/Admin/CampYearTab"

/**
 * One entry in the admin navigation. `id` doubles as the URL hash
 * (`/admin#payments`) and the DOM id of the section's panel.
 */
type AdminSection = {
  id: string
  label: string
  icon: React.ReactElement
  /** When set, the section is only offered to roles with this capability. */
  capability?: Capability
}

type AdminSectionGroup = {
  title: string
  sections: AdminSection[]
}

const SECTION_GROUPS: AdminSectionGroup[] = [
  {
    title: "Registrations",
    sections: [
      {
        id: "all-registrations",
        label: "All Registrations",
        icon: <PeopleOutlinedIcon />,
      },
      {
        id: "waitlist",
        label: "Waitlist & Pending Payments",
        icon: <PendingActionsOutlinedIcon />,
      },
      {
        id: "camper-checkout",
        label: "Camper Checkout",
        icon: <FactCheckOutlinedIcon />,
      },
      {
        id: "demographics",
        label: "Demographics",
        icon: <BarChartOutlinedIcon />,
        capability: "readDemographics",
      },
    ],
  },
  {
    title: "Finance",
    sections: [
      {
        id: "payments",
        label: "Payments",
        icon: <PaymentsOutlinedIcon />,
        capability: "managePayments",
      },
      {
        id: "camp-credits",
        label: "Camp Credits",
        icon: <RedeemOutlinedIcon />,
        capability: "manageCredits",
      },
    ],
  },
  {
    title: "Camp Setup",
    sections: [
      {
        id: "small-group-assignments",
        label: "Small Group Assignments",
        icon: <Diversity3OutlinedIcon />,
      },
      {
        id: "camp-year",
        label: "Camp Year",
        icon: <EventOutlinedIcon />,
        capability: "manageCampYear",
      },
    ],
  },
  {
    title: "Administration",
    sections: [
      {
        id: "create-test-data",
        label: "Create Test Data",
        icon: <ScienceOutlinedIcon />,
        capability: "createTestData",
      },
      {
        id: "admin-management",
        label: "Admin Management",
        icon: <AdminPanelSettingsOutlinedIcon />,
        capability: "manageAdmins",
      },
    ],
  },
]

const DEFAULT_SECTION_ID = SECTION_GROUPS[0].sections[0].id
const SIDEBAR_WIDTH = 272

const readSectionFromHash = (): string | null => {
  if (typeof window === "undefined") return null
  const id = window.location.hash.replace(/^#/, "")
  return id || null
}

const AdminPage: React.FC = () => {
  const { isAdmin, adminRole } = React.useContext(AuthContext)
  const { firestore, isTestData } = React.useContext(ProdContext)
  // The dashboard opens on config/site's currentCampYear (the year the site is
  // registering for, which is not the calendar year after the rollover). The
  // picker lets admins look at other years; until config resolves the year is
  // null and every section stays in its loading state instead of flashing the
  // calendar year. If config/site is missing the calendar year is a fallback.
  const { currentCampYear, loading: configLoading } = useSiteConfig()
  const configMissing = !configLoading && currentCampYear === null
  const defaultYear = configLoading ? null : currentCampYear ?? dayjs().year()
  const [selectedYear, setSelectedYear] = React.useState<number | null>(null)
  const year = selectedYear ?? defaultYear
  const [data, loading, error] = useRegistrations({
    isAdmin,
    adminRole,
    campYear: year,
    firestore,
  })

  // The requested section is remembered even if the role that unlocks it has
  // not loaded yet, so a deep link like /admin#payments survives auth loading.
  const [requestedSectionId, setRequestedSectionId] =
    React.useState<string>(DEFAULT_SECTION_ID)
  React.useEffect(() => {
    const fromHash = readSectionFromHash()
    if (fromHash) setRequestedSectionId(fromHash)
  }, [])

  const visibleGroups = React.useMemo(
    () =>
      SECTION_GROUPS.map((group) => ({
        ...group,
        sections: group.sections.filter(
          (section) =>
            !section.capability ||
            roleHasCapability(adminRole, section.capability)
        ),
      })).filter((group) => group.sections.length > 0),
    [adminRole]
  )
  const visibleSections = visibleGroups.flatMap((group) => group.sections)
  const activeSection =
    visibleSections.find((section) => section.id === requestedSectionId) ??
    visibleSections[0]

  const selectSection = (id: string) => {
    setRequestedSectionId(id)
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`)
    }
  }

  const theme = useTheme()
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("md"))

  if (!isAdmin) {
    return (
      <Container maxWidth="xl" sx={{ padding: 6 }}>
        <Stack justifyContent="center" spacing={2}>
          <Typography variant="h3" align="center">
            You do not have access to this page.
          </Typography>
          <LinkButton to="/" size="large">
            Return to Home Page
          </LinkButton>
        </Stack>
      </Container>
    )
  }

  const renderSection = (id: string) => {
    // Every section is keyed on a concrete camp year, so none is mounted
    // until config/site has told us which year the site is on.
    if (year === null) {
      return <LinearProgress aria-label="Loading camp year" />
    }
    switch (id) {
      case "all-registrations":
        return (
          <RegistrationDashboard
            data={data}
            loading={loading}
            campYear={year}
            adminRole={adminRole}
          />
        )
      case "waitlist":
        return (
          <Grid container justifyContent="center" spacing={1}>
            <Grid size={12}>
              <Waitlist data={data} loading={loading} campYear={year} />
            </Grid>
            <Grid size={12}>
              <PendingPayments data={data} loading={loading} />
            </Grid>
          </Grid>
        )
      case "camper-checkout":
        return <CamperCheckout data={data} loading={loading} campYear={year} />
      case "demographics":
        return <Demographics data={data} />
      case "payments":
        return <PaymentDashboard />
      case "camp-credits":
        return <CampCreditTab />
      case "small-group-assignments":
        return <SmallGroupAssignmentsV2 registrations={data} campYear={year} />
      case "camp-year":
        return <CampYearTab />
      case "create-test-data":
        return <CreateTestData campYear={year} />
      case "admin-management":
        return <AdminManagement />
      default:
        return null
    }
  }

  const yearPicker = (
    <DatePicker
      label="Camp year"
      value={year === null ? null : dayjs().set("year", year)}
      onChange={(newYear) => setSelectedYear(newYear?.year() ?? null)}
      disabled={year === null}
      views={["year"]}
      minDate={dayjs().set("year", 2017)}
      maxDate={dayjs().add(1, "year")}
      slotProps={{ textField: { size: "small", fullWidth: true } }}
    />
  )

  const sidebar = (
    <Paper
      variant="outlined"
      component="nav"
      aria-label="Admin sections"
      sx={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        alignSelf: "flex-start",
        position: "sticky",
        top: theme.spacing(2),
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Box sx={{ padding: 2, paddingBottom: 1 }}>
        <Typography variant="h5" component="h1" sx={{ marginBottom: 1.5 }}>
          Admin Dashboard
        </Typography>
        {yearPicker}
      </Box>
      <List dense disablePadding sx={{ paddingBottom: 1 }}>
        {visibleGroups.map((group) => (
          <li key={group.title}>
            <ul style={{ padding: 0 }}>
              <ListSubheader
                disableSticky
                sx={{
                  lineHeight: "32px",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "text.secondary",
                  backgroundColor: "transparent",
                }}
              >
                {group.title}
              </ListSubheader>
              {group.sections.map((section) => {
                const selected = section.id === activeSection?.id
                return (
                  <ListItemButton
                    key={section.id}
                    aria-current={selected ? "page" : undefined}
                    selected={selected}
                    onClick={() => selectSection(section.id)}
                    sx={{
                      marginX: 1,
                      marginY: 0.25,
                      borderRadius: 1,
                      paddingY: 0.75,
                      "&.Mui-selected": {
                        backgroundColor: "primary.light",
                        color: "primary.dark",
                        "& .MuiListItemIcon-root": { color: "primary.dark" },
                        "& .MuiListItemText-primary": { fontWeight: 700 },
                      },
                      "&.Mui-selected:hover": {
                        backgroundColor: "primary.light",
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      {section.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={section.label}
                      slotProps={{ primary: { fontSize: "0.9rem" } }}
                    />
                  </ListItemButton>
                )
              })}
            </ul>
          </li>
        ))}
      </List>
    </Paper>
  )

  const mobileHeader = (
    <Stack spacing={1.5} sx={{ marginBottom: 2 }}>
      <Typography variant="h4" component="h1">
        Admin Dashboard
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <Box sx={{ width: { xs: 1, sm: 180 }, flexShrink: 0 }}>
          {yearPicker}
        </Box>
        <TextField
          select
          fullWidth
          size="small"
          label="Section"
          value={activeSection?.id ?? ""}
          onChange={(event) => selectSection(event.target.value)}
          slotProps={{
            select: {
              // Show only the label once chosen; icons stay in the open menu.
              renderValue: (value) =>
                visibleSections.find((section) => section.id === value)
                  ?.label ?? "",
            },
          }}
        >
          {visibleGroups.flatMap((group) => [
            <ListSubheader key={`header-${group.title}`} disableSticky>
              {group.title}
            </ListSubheader>,
            ...group.sections.map((section) => (
              <MenuItem key={section.id} value={section.id}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {section.icon}
                </ListItemIcon>
                {section.label}
              </MenuItem>
            )),
          ])}
        </TextField>
      </Stack>
    </Stack>
  )

  const content = (
    <Box
      component="section"
      id={activeSection?.id}
      aria-label={activeSection?.label}
      sx={{ flexGrow: 1, minWidth: 0 }}
    >
      {isLargeScreen && (
        <Stack
          direction="row"
          alignItems="baseline"
          justifyContent="space-between"
          flexWrap="wrap"
          sx={{ marginBottom: 2 }}
        >
          <Typography variant="h4" component="h2">
            {activeSection?.label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {year}
            {isTestData ? " · test data" : ""}
          </Typography>
        </Stack>
      )}
      {configMissing && (
        <Alert severity="warning" sx={{ marginBottom: 2 }}>
          config/site has no current camp year, so the dashboard is showing the
          calendar year. Set it from the Camp Year section.
        </Alert>
      )}
      {error && (
        <Typography color="error" sx={{ marginBottom: 2 }}>
          {error.message}
        </Typography>
      )}
      {activeSection && renderSection(activeSection.id)}
    </Box>
  )

  return (
    <Container maxWidth="xl" sx={{ paddingX: { xs: 2, md: 3 }, paddingY: 2 }}>
      <SnackbarAlertProvider>
        {isLargeScreen ? (
          <Stack direction="row" spacing={3} alignItems="flex-start">
            {sidebar}
            {content}
          </Stack>
        ) : (
          <>
            {mobileHeader}
            {content}
          </>
        )}
      </SnackbarAlertProvider>
    </Container>
  )
}

export default AdminPage

export const Head = getPageTitle("Admin")
