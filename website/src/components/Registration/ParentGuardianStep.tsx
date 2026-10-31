import React from "react"
import {
  Autocomplete,
  Box,
  Checkbox,
  FormControlLabel,
  Grid,
  Stack,
  Typography,
} from "@mui/material"
import { Delete } from "@mui/icons-material"
import { overwrite, getNames, getName } from "country-list"
import states from "states-us"

// Local Components
import RegistrationStep from "./RegistrationStep"
import { TextFieldWithFormValidation } from "@components/Inputs"
import { AnimatedIconButton } from "@components/Button"
import { ParentRegSVG } from "@components/SVG"

// Registration Data Context
import {
  RegistrationDataContext,
  RegistrationDispatchContext,
  RegistrationData,
  RegistrationActionType,
} from "./RegistrationDataContext"

// Replace Taiwan's name
overwrite([
  {
    code: "TW",
    name: "Taiwan",
  },
])
const COUNTRIES = ["United States of America", ...getNames()]

type ParentGuardianFormProps = {
  parent: RegistrationData["parents"][0]
  family: RegistrationData["family"]
  index: number
}
function ParentGuardianForm({
  parent,
  family,
  index,
}: ParentGuardianFormProps) {
  const dispatch = React.useContext(RegistrationDispatchContext)

  const editParentHandler =
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditParent,
        index: index,
        keyToChange: keyToChange,
        newValue: event.target.value,
      })

  // Only the first parent needs to fill out the street address info but we'll keep it here anyways.
  const showFamilyFields = index === 0
  const editFamilyHandler =
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditFamily,
        keyToChange: keyToChange,
        newValue: event.target.value,
      })

  return (
    <Grid
      container
      spacing={3}
      alignItems="stretch"
      sx={{
        padding: 1.5,
      }}
    >
      <Grid size={12} sx={{ paddingTop: 5, paddingBottom: 5 }}>
        <Stack direction="row" justifyContent="space-between" width={1}>
          <Typography variant="h4">Parent/Guardian {index + 1}</Typography>
          {index > 0 && (
            <AnimatedIconButton
              boopProps={{ scale: 1.1 }}
              onClick={() =>
                dispatch({
                  type: RegistrationActionType.RemoveParent,
                  index: index,
                })
              }
            >
              <Delete color="primary" />
            </AnimatedIconButton>
          )}
        </Stack>
      </Grid>
      <Grid size={6}>
        <TextFieldWithFormValidation
          required
          id="parent-first-name"
          label="First Name"
          fullWidth
          value={parent.firstName}
          onChange={editParentHandler("firstName")}
        />
      </Grid>
      <Grid size={6}>
        <TextFieldWithFormValidation
          required
          id="parent-last-name"
          label="Last Name"
          fullWidth
          value={parent.lastName}
          onChange={editParentHandler("lastName")}
        />
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <TextFieldWithFormValidation
          required
          id="parent-email"
          label="Email"
          type="email"
          error={parent.email && !parent.email.includes("@")}
          fullWidth
          value={parent.email?.toLowerCase() ?? ""}
          onChange={editParentHandler("email")}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextFieldWithFormValidation
          required
          id="parent-phone-number"
          label="US Phone Number"
          fullWidth
          type="tel"
          value={parent.phoneNumber ?? ""}
          onChange={editParentHandler("phoneNumber")}
        />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <TextFieldWithFormValidation
          id="parent-line-id"
          label="LINE ID (optional)"
          fullWidth
          value={parent.lineId ?? ""}
          onChange={editParentHandler("lineId")}
        />
      </Grid>

      {/* Hide Family for the additional parent/guardians */}
      {showFamilyFields && (
        <>
          <Grid size={12}>
            <TextFieldWithFormValidation
              required
              id="family-street-address"
              label="Street Address"
              fullWidth
              value={family.street}
              onChange={editFamilyHandler("street")}
            />
          </Grid>

          <Grid size={12}>
            <TextFieldWithFormValidation
              id="family-suite"
              label="Suite"
              fullWidth
              value={family.suite ?? ""}
              onChange={editFamilyHandler("suite")}
            />
          </Grid>

          <Grid size={{ xs: 8, md: 9 }}>
            <TextFieldWithFormValidation
              required
              id="family-city"
              label="City"
              fullWidth
              value={family.city}
              onChange={editFamilyHandler("city")}
            />
          </Grid>
          <Grid size={{ xs: 4, md: 3 }}>
            <TextFieldWithFormValidation
              required
              id="family-zipcode"
              label="ZIP Code"
              fullWidth
              value={family.zip}
              onChange={editFamilyHandler("zip")}
            />
          </Grid>

          <Grid size={6}>
            <Autocomplete
              id="family-country"
              options={COUNTRIES}
              getOptionLabel={(option) => option}
              autoHighlight
              fullWidth
              value={family.country ?? ""}
              onChange={(_event, newValue) =>
                dispatch({
                  type: RegistrationActionType.EditFamily,
                  keyToChange: "country",
                  newValue: newValue,
                })
              }
              renderInput={(params) => (
                <TextFieldWithFormValidation
                  required
                  label="Country"
                  {...params}
                  value={family.country}
                />
              )}
            />
          </Grid>
          <Grid size={6}>
            <Autocomplete
              id="family-state"
              freeSolo
              // freeSolo={family.country !== getName("US")}
              fullWidth
              disableClearable
              options={
                family.country === getName("US")
                  ? states.map((state) => state.abbreviation)
                  : []
              }
              value={family.state ?? ""}
              onChange={(_event, newValue) =>
                dispatch({
                  type: RegistrationActionType.EditFamily,
                  keyToChange: "state",
                  newValue: newValue,
                })
              }
              renderInput={(params) => (
                <TextFieldWithFormValidation
                  required
                  label="State/Province"
                  {...params}
                  value={family.state}
                />
              )}
            />
          </Grid>
        </>
      )}

      <Grid size={12}>
        {/* Checkbox has a different type of target value so we'll redefine the handler here */}
        <FormControlLabel
          label="Subscribe me to to the LYF mailing list to receive event updates and quarterly newsletters!"
          control={
            <Checkbox
              checked={!!parent.subscribeToMailingList}
              color="primary"
              onChange={(event) =>
                dispatch({
                  type: RegistrationActionType.EditParent,
                  index: index,
                  keyToChange: "subscribeToMailingList",
                  newValue: event.target.checked,
                })
              }
            />
          }
        />
      </Grid>
    </Grid>
  )
}

export default function ParentGuardianStep() {
  const registrationState = React.useContext(RegistrationDataContext)
  const dispatch = React.useContext(RegistrationDispatchContext)

  return (
    <RegistrationStep
      title="Parent/Guardian Information"
      sidebarContent={
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            position: "sticky",
            top: "80px",
          }}
        >
          <ParentRegSVG width={300} height={400} />
        </Box>
      }
      primaryButtonText="Next"
      secondaryButtonText="Add Secondary Parent/Guardian"
      secondaryButtonHandler={() =>
        dispatch({ type: RegistrationActionType.AddParent })
      }
      tertiaryButtonText="Back"
    >
      {registrationState.parents.map((parent, i) => (
        <ParentGuardianForm
          key={i}
          parent={parent}
          family={registrationState.family}
          index={i}
        />
      ))}
    </RegistrationStep>
  )
}
