import React from "react"
import {
  Grid,
  Stack,
  Typography,
} from "@mui/material"

import RegistrationStep  from "./RegistrationStep"
import {
  FormRadioGroup,
  TextFieldWithFormValidation,
} from "@components/Inputs"

// Registration Data Context
import {
  RegistrationDispatchContext,
  RegistrationData,
  RegistrationActionType,
} from "./RegistrationDataContext"

const CAMPER_MESSAGE_LABEL = "Write a message to your kids for them to decipher during camp! What are your hopes for them to enjoy, experience, and learn from camp?! As part of the culture activity for our campers, Non-English responses are highly encouraged! Please feel free to use your heritage language here."
const CAMPER_MESSAGE_EXAMPLES = "E.g. Immersion in a Taiwanese-American community; life-long memories with friends; understanding more about being Taiwanese-American, etc."

// Heritage language
const CULTURE_LANGUAGE_LABEL = "How often do you incorporate heritage language (Mandarin/Taiwanese Hokkien/Other) into your daily home life?"
const CULTURE_LANGUAGE_OPTIONS = [
  "Fluent conversations",
  "Daily phrases",
  "Special occasions only",
  "Never"
]

// Comfort with culture
const CULTURE_COMFORT_LABEL = "How confident do you feel explaining Taiwanese holidays or traditions to your child?"
const CULTURE_COMFORT_OPTIONS = [
  "Very confident",
  "Somewhat confident",
  "Could learn more about Taiwanese traditions",
  "Teach me!"
]

// Which aspect of Taiwanese culture would you be interested to learn more about?
const CULTURE_LEARNING_LABEL = "Which aspects of Taiwanese culture would you be interested to learn more about?"
const CULTURE_LEARNING_OPTIONS = [
  "Taiwanese cuisine and food",
  "Taiwanese history and origins",
  "Taiwanese-American identity and representation",
  "Taiwanese movies, music, and shows",
  "Taiwanese languages and colloquialisms",
  "Other"
]

// Understanding any barriers parents would have to learn more about culture
const CULTURE_BARRIER_LABEL = "What is your biggest barrier to engaging with Taiwanese culture?"
const CULTURE_BARRIER_OPTIONS = [
  "Lack of time",
  "Unsure where to start",
  "Not as interested in this topic",
  "Kids are disinterested",
  "Other"
]

const CULTURE_IMPART_LABEL = "What part of culture would you hope is imparted to your kids?"
const CULTURE_IMPART_EXAMPLES = "Kindess and warmth in interactions, language, family, etc."

type ParentCultureStepProps = {
  household: RegistrationData["household"]
}

export default function FamilyCultureStep(
  {household}: ParentCultureStepProps) {
    const dispatch = React.useContext(RegistrationDispatchContext)

    const editHouseholdHandler = 
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditHousehold,
        keyToChange: keyToChange,
        newValue: event.target.value,
      })

  const disclaimer = (
    <Stack spacing={1} sx={{ paddingTop: 1 }}>
      <Typography variant="body1" color="secondary">
        Why are we asking these questions?
      </Typography>
      <Typography sx={{ lineHeight: 2 }}>
        Culture Committee on the leadership team is planning some fun activities and programming for campers this year and we would love to for you help!
        <br />
        <br />
        We recognize the importance of providing a strong cultural experience that is as
        genuine as the youth would experience in Taiwan and want to better understand how we can
        tailor the cultures experience in a summer camp that is closer aligned those experiences,
        This would help us execute certain programming and build up resources for not only our 
        campers, but also the needs of their parents.
      </Typography>
    </Stack>
  )
  return (
    <RegistrationStep
      title="Culture Information"
      sidebarContent={disclaimer}
      primaryButtonText="Next"
      secondaryButtonText="Back"
      contentSpacing={4}
    >
      {/* Shouldn't need this grid as it's already included in sidebarContent */}
      {/* <Grid
        size={12}
        sx={{
          display: { xs: "block", sm: "none" },
        }}
      >
        {disclaimer}
      </Grid> */}

      {/* Camper Message */}
      <Grid size={12}>
        <TextFieldWithFormValidation
          required
          id="household-message"
          label={CAMPER_MESSAGE_EXAMPLES}
          formLabel={CAMPER_MESSAGE_LABEL}
          fullWidth
          multiline
          minRows={3}
          value={household.camperMessage}
          onChange={editHouseholdHandler("camperMessage")}
        />
      </Grid>
      
      <Grid size={12}>
        <FormRadioGroup
          id="household-language-frequency"
          label={CULTURE_LANGUAGE_LABEL}
          options={CULTURE_LANGUAGE_OPTIONS}
          value={household.languageFrequency}
          onChange={editHouseholdHandler("languageFrequency")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="household-culture-confidence"
          label={CULTURE_COMFORT_LABEL}
          options={CULTURE_COMFORT_OPTIONS}
          value={household.cultureConfidence}
          onChange={editHouseholdHandler("cultureConfidence")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="household-culture-learning"
          label={CULTURE_LEARNING_LABEL}
          options={CULTURE_LEARNING_OPTIONS}
          value={household.cultureLearn}
          onChange={editHouseholdHandler("cultureLearn")}
        />
      </Grid>

      <Grid size={12}>
        <FormRadioGroup
          id="household-culture-barrier"
          label={CULTURE_BARRIER_LABEL}
          options={CULTURE_BARRIER_OPTIONS}
          value={household.cultureBarrier}
          onChange={editHouseholdHandler("cultureBarrier")}
        />
      </Grid>

      <Grid size={12}>
        <TextFieldWithFormValidation
          id="household-culture-lesson"
          // Reduce redundancy and improve phrasing
          label={CULTURE_IMPART_EXAMPLES}
          formLabel={CULTURE_IMPART_LABEL}
          fullWidth
          multiline
          minRows={3}
          value={household.cultureLesson}
          onChange={editHouseholdHandler("cultureLesson")}
        />
      </Grid>
      
    </RegistrationStep>
  )
}