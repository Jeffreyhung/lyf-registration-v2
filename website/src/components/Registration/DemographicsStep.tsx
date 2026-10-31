import React from "react"
import { Grid, Stack, Typography } from "@mui/material"

// Local Components
import RegistrationStep from "./RegistrationStep"
import {
  FormCheckboxGroup,
  FormRadioGroup,
  TextFieldWithFormValidation,
} from "@components/Inputs"

// Registration Data Context
import {
  RegistrationDispatchContext,
  RegistrationData,
  RegistrationActionType,
} from "./RegistrationDataContext"

// TODO Move these out into some CMS
const BORN_OPTIONS = ["In the US", "In Taiwan", "Prefer not to say", "Other"]
const ETHNICITY_OPTIONS = [
  "Taiwanese",
  "Chinese",
  "Other East Asian",
  "Southeast Asian",
  "Pacific Islander",
  "South Asian",
  "White",
  "Black",
  "Native American",
  "Hispanic or Latino",
  "Prefer not to say",
  "Other",
]

const GENERATION_OPTIONS = [
  "1st Generation: born and raised abroad",
  "1.5 Generation: born abroad and raised partially abroad",
  "2nd Generation: born in the US, parent(s) born abroad",
  "3rd Generation: at least one of the camper's parents was born in the US",
  "4th+ Generation: at least one of the camper's grandparents was born in the US",
  "Prefer not to say",
  "Other",
]
const LANGUAGE_PROFICIENCY_OPTIONS = [
  "None",
  "Basic",
  "Conversational",
  "Fluent",
  "Prefer not to say",
  "Other",
]

type DemographicsStepProps = {
  demographics: RegistrationData["demographics"][0]
  demographicsIndex: number
}

export default function DemographicsStep({
  demographics,
  demographicsIndex,
}: DemographicsStepProps) {
  const dispatch = React.useContext(RegistrationDispatchContext)

  const editDemographicHandler =
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditDemographics,
        index: demographicsIndex,
        keyToChange,
        newValue: event.target.value,
      })

  const disclaimer = (
    <Stack spacing={1} sx={{ paddingTop: 1 }}>
      <Typography variant="body1" color="secondary">
        Why are we asking these questions?
      </Typography>
      <Typography sx={{ lineHeight: 2 }}>
        For the last couple decades, LYF camp has been a camp primarily run by
        2nd generation Taiwanese Americans with a majority of campers attending
        also 2nd generation Taiwanese Americans. With the passage of time we
        have seen an increase in 3rd generation campers and campers of mixed
        ethnic backgrounds. Better understanding our camper demographics helps
        us maintain our commitment to the Taiwanese American youth community as
        a whole!
      </Typography>
    </Stack>
  )

  const immediateFamilyLabel = (
    <>
      Is an immediate family member(s) (sibling, child, and/or parent) a current
      or former LYF staff and/or leadership?
      <br />
      If so, please name and list all years involved in what capacity and list
      people who we can verify this information with if necessary
    </>
  )

  return (
    <RegistrationStep
      title="Camper Demographics (optional)"
      sidebarContent={disclaimer}
      primaryButtonText="Next"
      secondaryButtonText="Back"
      contentSpacing={4}
    >
      {/* <Grid
        size={12}
        sx={{
          display: { xs: "block", sm: "none" },
        }}
      >
        {disclaimer}
      </Grid> */}

      <Grid size={12} sx={{ paddingTop: 3 }}>
        <Typography variant="h6">Camper {demographicsIndex + 1}</Typography>
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="demographics-born"
          label="Where was your child born?"
          options={BORN_OPTIONS}
          value={demographics.born}
          onChange={editDemographicHandler("born")}
        />
      </Grid>

      <Grid size={12}>
        <FormCheckboxGroup
          id="demographics-ethnicity"
          label="Camper Ethnicity (select all that apply)"
          value={demographics.ethnicity}
          setValue={(ethnicity: string[]) =>
            dispatch({
              type: RegistrationActionType.EditDemographics,
              index: demographicsIndex,
              keyToChange: "ethnicity",
              newValue: ethnicity,
            })
          }
          options={ETHNICITY_OPTIONS}
          size={{
            xs: 6,
            sm: 4,
            md: 3,
          }}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="demographics-generation"
          label="My child best identifies as..."
          options={GENERATION_OPTIONS}
          value={demographics.generation}
          onChange={editDemographicHandler("generation")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="demographics-mandarin"
          label="What is your child's level of fluency in Mandarin?"
          options={LANGUAGE_PROFICIENCY_OPTIONS}
          value={demographics.mandarinLanguage}
          onChange={editDemographicHandler("mandarinLanguage")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="demographics-hokkien"
          label="What is your child's level of fluency in Taiwanese Hokkien?"
          options={LANGUAGE_PROFICIENCY_OPTIONS}
          value={demographics.hokkienLanguage}
          onChange={editDemographicHandler("hokkienLanguage")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
        // Should be demographics-hakka?
          id="demographics-mandarin"
          label="What is your child's level of fluency in Taiwanese Hakka?"
          options={LANGUAGE_PROFICIENCY_OPTIONS}
          value={demographics.hakkaLanguage}
          onChange={editDemographicHandler("hakkaLanguage")}
        />
      </Grid>

      <Grid size={12}>
        <TextFieldWithFormValidation
          id="immediate-family"
          label="Immediate family with LYF?"
          formLabel={immediateFamilyLabel}
          fullWidth
          multiline
          minRows={3}
          value={demographics.immediateFamily}
          onChange={editDemographicHandler("immediateFamily")}
        />
      </Grid>

      <Grid size={12}>
        <TextFieldWithFormValidation
          id="other-background"
          label="Other background?"
          formLabel="Is there any other information to help us understand your child's background?"
          fullWidth
          multiline
          minRows={3}
          value={demographics.otherBackground}
          onChange={editDemographicHandler("otherBackground")}
        />
      </Grid>
    </RegistrationStep>
  )
}
