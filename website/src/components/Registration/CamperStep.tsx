import React from "react"
import {
  Box,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  ListItemIcon,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material"
import { TaskAlt, ErrorOutline, Add } from "@mui/icons-material"

// Local Components
import RegistrationStep from "./RegistrationStep"
import {
  FormCheckboxGroup,
  FormRadioGroup,
  NumberInputWithFormValidation,
  TextFieldWithFormValidation,
} from "@components/Inputs"

// Registration Data Context
import {
  CampTrack,
  getCampTrack,
  RegistrationStatus,
} from "lyf-registration-schemas"
import {
  RegistrationDispatchContext,
  RegistrationData,
  RegistrationActionType,
} from "./RegistrationDataContext"
import Waiver from "./Waiver"
import { AnimatedIconButton } from "@components/Button"
import {
  FamilyData,
  RegistrationDocumentWithCamperId,
} from "@hooks/useFamilyData"
import { CamperRegSVG } from "@components/SVG"
import dayjs from "dayjs"

type CamperStepProps = {
  camper: RegistrationData["campers"][0]
  camperIndex: number
  campersInDatabase: FamilyData["campers"]
  registrations: RegistrationDocumentWithCamperId[]
  campYear: number
}

const GENDER_OPTIONS = [
  "Male",
  "Genderqueer/Gender Nonconforming",
  "Female",
  "Prefer Not to Say",
  "Transgender",
  "Something Else",
]
const CABIN_PREFERENCE_OPTIONS = [
  "Boys Cabin",
  "Girls Cabin",
  "All-Gender Cabin",
]
// TODO: This really needs to be moved into a CMS
const CABIN_TOOLTIP = `
TACL-LYF welcomes children all across the gender spectrum and assigns bunks based on various factors to ensure that everyone is welcomed, included, and celebrated. We offer boys, girls, and all-gender cabin options. All-gender cabins are good options for children who identify as nonbinary, trans or gender expansive, prefer to bunk with children of other genders, who want to be part of an LGBTQ+ affinity space, or for campers who feel this is the best fit for any reason.

If there isn't enough interest in an all-gender cabin, we will contact families to explore options. All of our counselors are trained to create a safe and welcoming environment for all genders. For any specific questions or concerns about your child's bunking, please email us at lyf@tacl.org.
`
const TSHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"]
const COLORS = ["primary", "secondary", "tertiary"] as const
const CAMP_TRACKS = Object.values(CampTrack)

export const getColorFromCampTrack = (campTrack: CampTrack) => {
  return COLORS[CAMP_TRACKS.indexOf(campTrack) % COLORS.length]
}

/**
 * Validate if the grade provided matches the birthday given the camp year
 * Kids generally graduate 12th grade when they're 18.
 *
 * California has a cutoff that kids must be 5 on Sept 1st of their first year of kindergarten which means
 * their age to grade offset is 7 instead of 6.
 */
function checkGradeAndAgeValid(
  birthDate: string | null,
  grade: number | null,
  campYear: number
): boolean {
  if (birthDate == null || grade == null) {
    return true
  }

  const birthday = dayjs(birthDate)
  // dayjs 0-indexes their months, so this is September.
  const schoolYearAgeOffset = birthday.month() < 8 ? 6 : 7

  return campYear - birthday.year() - schoolYearAgeOffset == grade
}

export default function CamperStep({
  camper,
  camperIndex,
  campersInDatabase,
  registrations,
  campYear,
}: CamperStepProps) {
  const dispatch = React.useContext(RegistrationDispatchContext)
  const [selectedPreFillCamper, setPreFillCamper] = React.useState<string>(
    camper.id ?? ""
  )
  const isDisabled = selectedPreFillCamper === "" && !camper.firstName

  // Open the waiver signature
  const isWaiverSigned =
    camper.waiverSignature &&
    camper.waiverSignature !== "" &&
    camper.waiverFullName &&
    camper.waiverSignDate
  const [waiverOpen, setWaiverOpen] = React.useState(false)

  const editCamperHandler =
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditCamper,
        index: camperIndex,
        keyToChange,
        newValue: event.target.value,
      })

  const isGradeAndAgeValid = checkGradeAndAgeValid(
    camper.birthDate,
    camper.grade,
    campYear
  )

  return (
    <RegistrationStep
      title="Camper Information"
      sidebarContent={
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            position: "sticky",
            top: "80px",
          }}
        >
          <CamperRegSVG width={300} height={400} />
        </Box>
      }
      primaryButtonText={isWaiverSigned ? "Next" : "Sign Liability Waiver"}
      primaryButtonHandler={
        isWaiverSigned ? undefined : () => setWaiverOpen(true)
      }
      secondaryButtonText="Back"
    >
      <Grid
        size={12}
        sx={{
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        <TextFieldWithFormValidation
          id="select-a-camper"
          label="Select a camper"
          helperText="We'll automatically pre-fill your camper's information below."
          fullWidth
          select
          value={selectedPreFillCamper}
          onChange={(event) => {
            setPreFillCamper(event.target.value)

            // Find the camper and if it exists, the pre-fill the camper
            const selectedCamper = campersInDatabase.find(
              (c) => c.id === event.target.value
            )
            if (selectedCamper) {
              dispatch({
                type: RegistrationActionType.PrefillCamper,
                index: camperIndex,
                camper: selectedCamper,
              })
            }
          }}
        >
          {campersInDatabase.map((c) => {
            const reg = registrations.find((r) => r.camperId === c.id)
            const alreadyRegistered = reg?.status === RegistrationStatus.ACTIVE
            return (
              <MenuItem key={c.id} value={c.id} disabled={alreadyRegistered}>
                {`${c.firstName} ${c.lastName}`}
                {!alreadyRegistered &&
                  reg?.isPreRegistered &&
                  " (Pre-Registered)"}
                {alreadyRegistered && " (Already Registered)"}
              </MenuItem>
            )
          })}
          <Divider />
          <MenuItem value={"Add a new camper"}>
            <Stack direction="row" alignItems="center">
              <ListItemIcon>
                <Add fontSize="small" />
              </ListItemIcon>
              <Typography>Add a new camper</Typography>
            </Stack>
          </MenuItem>
        </TextFieldWithFormValidation>
      </Grid>
      <Grid
        container
        size={12}
        id={`camper-${camperIndex}-container`}
        spacing={3}
        alignItems="stretch"
        sx={{
          margin: 1.5, // For some reason grid margin is 12px, so this is to match the other boxes
          padding: 3,
          borderStyle: "solid",
          borderWidth: 1,
          borderColor: "primary.main",
          borderRadius: 2,
          backgroundColor: "white",
          position: "relative",

          // Following are used to indicate the form is disabled
          opacity: isDisabled ? 0.3 : 1,
          pointerEvents: isDisabled
            ? "none"
            : "inherit" /* prevent mouse events */,
        }}
      >
        <Typography
          variant="h5"
          sx={{
            position: "absolute",
            lineHeight: 1,
            left: "1rem",
            top: "-1.25rem",
            zIndex: 1000,
            paddingLeft: 1,
            paddingRight: 1,
            marginTop: 1,
            backgroundColor: "white",
            borderRadius: 2,
          }}
        >
          Camper {camperIndex + 1}
        </Typography>

        {/* Begin form fields */}
        <Grid size={6}>
          <TextFieldWithFormValidation
            required
            id="camper-first-name"
            label="First Name"
            fullWidth
            value={camper.firstName}
            onChange={editCamperHandler("firstName")}
            disabled={isDisabled}
          />
        </Grid>
        <Grid size={6}>
          <TextFieldWithFormValidation
            required
            id="camper-last-name"
            label="Last Name"
            fullWidth
            value={camper.lastName}
            onChange={editCamperHandler("lastName")}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextFieldWithFormValidation
            id="camper-preferred-name"
            label="Preferred Name (optional)"
            fullWidth
            value={camper.preferredName}
            onChange={editCamperHandler("preferredName")}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextFieldWithFormValidation
            required
            id="camper-birthday"
            label="Birthday"
            fullWidth
            value={camper.birthDate}
            onChange={editCamperHandler("birthDate")}
            type="date"
            // So that the text doesn't overlap
            InputLabelProps={{ shrink: true }}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <FormControl fullWidth required>
            <FormLabel id="camper-grade" sx={{ paddingBottom: 1 }}>
              Grade that camper will complete in{" "}
              <strong>Spring {campYear}</strong>
            </FormLabel>
            {/* Interior grid to make number input only take up half the space */}
            <Grid container alignItems="center" gap={3}>
              <Grid size={6}>
                <NumberInputWithFormValidation
                  aria-labelledby="camper-grade"
                  required
                  disabled={isDisabled}
                  value={camper.grade}
                  max={12}
                  min={1}
                  onChange={(_event, val) => {
                    dispatch({
                      type: RegistrationActionType.EditCamper,
                      index: camperIndex,
                      keyToChange: "grade",
                      newValue: val,
                    })

                    // Also update the camp track
                    if (val) {
                      dispatch({
                        type: RegistrationActionType.EditCamper,
                        index: camperIndex,
                        keyToChange: "campTrack",
                        newValue: getCampTrack(val),
                      })
                    }
                  }}
                  error={camper.grade < 4}
                />
              </Grid>
              <Grid
                size={{
                  xs: 5,
                  md: 2,
                }}
              >
                {camper.campTrack && (
                  <Chip
                    label={`${camper.campTrack} Camp Track`}
                    /* @ts-expect-error Tertiary not supported */
                    color={getColorFromCampTrack(camper.campTrack)}
                  />
                )}
              </Grid>
              <Grid
                size={{
                  xs: 12,
                  md: 3,
                }}
              >
                {!isGradeAndAgeValid && (
                  <Typography variant="caption" color="warning">
                    Potential grade mismatch! Double check grade is for Spring{" "}
                    {campYear}
                  </Typography>
                )}
              </Grid>
            </Grid>

            <FormHelperText>
              {camper.grade < 4
                ? "Campers who have not yet completed 4th grade are not eligible."
                : ""}
            </FormHelperText>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextFieldWithFormValidation
            id="tshirt-sizing"
            label="T-Shirt Size (Adult sizing)"
            required
            fullWidth
            select
            value={camper.shirtSize}
            onChange={editCamperHandler("shirtSize")}
            disabled={isDisabled}
          >
            {TSHIRT_SIZES.map((option) => (
              <MenuItem key={`tshirt-size-${option}`} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextFieldWithFormValidation>
        </Grid>

        {/* Here to force a new line */}
        <Grid size={1} />

        <Grid size={12}>
          <FormControl disabled={isDisabled}>
            <FormLabel id="attended-camp-before">
              Has this camper attended LYF camp before?
            </FormLabel>
            {/* A radio's event value is always a string ("true" / "false"),
                and the registration callable requires a boolean. */}
            <RadioGroup
              row
              aria-labelledby="attended-camp-before"
              defaultValue={false}
              name="radio-buttons-group"
              value={camper.isReturning ?? false}
              onChange={(event) =>
                dispatch({
                  type: RegistrationActionType.EditCamper,
                  index: camperIndex,
                  keyToChange: "isReturning",
                  newValue: event.target.value === "true",
                })
              }
            >
              <FormControlLabel value={true} control={<Radio />} label="Yes" />
              <FormControlLabel value={false} control={<Radio />} label="No" />
            </RadioGroup>
          </FormControl>
        </Grid>

        <Grid size={12}>
          <FormCheckboxGroup
            required
            value={camper.gender}
            setValue={(gender: string[]) =>
              dispatch({
                type: RegistrationActionType.EditCamper,
                index: camperIndex,
                keyToChange: "gender",
                newValue: gender,
              })
            }
            options={GENDER_OPTIONS}
            id="camper-gender"
            label="Gender Identity (check one or more options that reflect the camper's gender)"
            size={6}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextFieldWithFormValidation
            id="camper-pronouns"
            label="Pronouns (optional)"
            fullWidth
            value={camper.pronouns}
            onChange={editCamperHandler("pronouns")}
            helperText="she/her, he/him, they/them, etc."
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <FormRadioGroup
            options={CABIN_PREFERENCE_OPTIONS}
            label="What cabin would your camper like to be in?"
            required={true}
            onChange={editCamperHandler("cabinPreference")}
            value={camper.cabinPreference}
            tooltip={CABIN_TOOLTIP}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <TextFieldWithFormValidation
            id="diet-and-food-allergies"
            label="Diet Considerations and Food Allergies"
            helperText="Please list any camper diet considerations or food allergies. If none, write N/A"
            fullWidth
            multiline
            minRows={6}
            value={camper.dietAndFoodAllergies}
            onChange={editCamperHandler("dietAndFoodAllergies")}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <TextFieldWithFormValidation
            id="medical-conditions"
            label="Medical Conditions and Medications"
            helperText="Please list any camper medical conditions and medications their counselor should be made aware of. If none, write N/A"
            fullWidth
            multiline
            minRows={6}
            value={camper.medicalConditions}
            onChange={editCamperHandler("medicalConditions")}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <TextFieldWithFormValidation
            id="additional-notes"
            label="Additional Notes (optional)"
            helperText="Please add in any relatives registering for camp here"
            fullWidth
            multiline
            minRows={3}
            value={camper.additionalNotes}
            onChange={editCamperHandler("additionalNotes")}
            disabled={isDisabled}
          />
        </Grid>

        <Grid size={12}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AnimatedIconButton
              boopProps={{ scale: 1.1 }}
              onClick={() => setWaiverOpen(true)}
            >
              {isWaiverSigned ? (
                <TaskAlt color="primary" />
              ) : (
                <ErrorOutline color="error" />
              )}
            </AnimatedIconButton>

            <Typography
              variant="body1"
              onClick={() => setWaiverOpen(true)}
              sx={{
                cursor: "pointer",
              }}
            >
              {isWaiverSigned
                ? "Liability Waiver Signed"
                : "Liability Waiver Not Signed"}
            </Typography>
          </Stack>
        </Grid>
        {/* End of Camper Container */}
      </Grid>

      {/* Waiver */}
      <Waiver
        anchor="right"
        open={waiverOpen}
        camper={camper}
        camperIndex={camperIndex}
        setWaiverOpen={setWaiverOpen}
        onClose={() => setWaiverOpen(false)}
      />
    </RegistrationStep>
  )
}
