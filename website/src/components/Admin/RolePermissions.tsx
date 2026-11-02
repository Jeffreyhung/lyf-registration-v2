import React from "react"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import CheckIcon from "@mui/icons-material/Check"
import {
  ADMIN_ROLES,
  AdminRole,
  Capability,
  ROLE_CAPABILITIES,
} from "lyf-registration-schemas"

// The table below is rendered from ROLE_CAPABILITIES so it can never disagree
// with what the website, functions and Firestore rules actually enforce. The
// text here only explains what each capability unlocks in the console.
const CAPABILITY_ROWS: { capability: Capability; label: string; detail: string }[] =
  [
    {
      capability: "writeRegistrations",
      label: "Edit registrations",
      detail:
        "Change status, internal notes, contacted and checked-out flags, small group and cabin preference from All Registrations and Camper Checkout.",
    },
    {
      capability: "readHealth",
      label: "See health information",
      detail:
        "Medical conditions and diet / food allergy columns in the grid and in camper exports.",
    },
    {
      capability: "readDemographics",
      label: "Demographics section",
      detail:
        "Charts of camper grade, gender, birthplace, ethnicity and language fluency.",
    },
    {
      capability: "manageWaitlist",
      label: "Move campers off the waitlist",
      detail: "The move-off-waitlist action in Waitlist & Pending Payments.",
    },
    {
      capability: "managePayments",
      label: "Payments section",
      detail:
        "Payment records for a family and the payment actions on selected registrations.",
    },
    {
      capability: "manageCredits",
      label: "Camp Credits section",
      detail: "Look up and change a family's camp credits.",
    },
    {
      capability: "manageCampYear",
      label: "Camp Year section",
      detail:
        "Yearly rollover: dates, fees, capacity, display toggles and the late-registration bypass list.",
    },
    {
      capability: "createTestData",
      label: "Create Test Data section",
      detail: "Seed sample families and registrations in the test database.",
    },
    {
      capability: "manageAdmins",
      label: "Admin Management section",
      detail: "Add, disable, remove admins and change their roles (this page).",
    },
  ]

const ROLE_SUMMARIES: Record<AdminRole, string> = {
  full_admin:
    "Everything, including the admin roster. The only role that can add or remove families, campers and registrations directly. Keep this to a small number of people.",
  program_admin:
    "Full Admin minus the admin roster: health data, payments, credits, waitlist, test data and the yearly Camp Year rollover.",
  program_staff:
    "Day-to-day camp operations: view everything except health data; edit registrations, move campers off the waitlist, handle payments and camp credits, create test data.",
  health_staff:
    "Read-only view of everything, including camper health information. Cannot edit registrations.",
}

export default function RolePermissions({
  roleLabels,
}: {
  roleLabels: Record<AdminRole, string>
}) {
  return (
    <Accordion disableGutters variant="outlined">
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">What each role can do</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" paragraph>
          Every admin can sign in to the console and see All Registrations,
          Waitlist &amp; Pending Payments, Camper Checkout, Small Group
          Assignments and Demographics. The role decides what else they can
          see and change. Pick the lowest role that covers the job.
        </Typography>

        <Box component="dl" sx={{ m: 0, mb: 2 }}>
          {ADMIN_ROLES.map((role) => (
            <Box key={role} sx={{ mb: 1 }}>
              <Typography component="dt" variant="subtitle2">
                {roleLabels[role]}
              </Typography>
              <Typography
                component="dd"
                variant="body2"
                color="text.secondary"
                sx={{ ml: 0 }}
              >
                {ROLE_SUMMARIES[role]}
              </Typography>
            </Box>
          ))}
        </Box>

        <TableContainer>
          <Table size="small" aria-label="Permissions by role">
            <TableHead>
              <TableRow>
                <TableCell>Permission</TableCell>
                {ADMIN_ROLES.map((role) => (
                  <TableCell key={role} align="center">
                    {roleLabels[role]}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {CAPABILITY_ROWS.map(({ capability, label, detail }) => (
                <TableRow key={capability}>
                  <TableCell>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {detail}
                    </Typography>
                  </TableCell>
                  {ADMIN_ROLES.map((role) => {
                    const allowed = ROLE_CAPABILITIES[role][capability]
                    return (
                      <TableCell
                        key={role}
                        align="center"
                        aria-label={allowed ? "Allowed" : "Not allowed"}
                      >
                        {allowed ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.disabled"
                          >
                            –
                          </Typography>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
          Disabling an admin keeps their entry but removes all access until
          they are re-enabled. The last remaining Full Admin cannot be removed,
          disabled or demoted.
        </Typography>
      </AccordionDetails>
    </Accordion>
  )
}
