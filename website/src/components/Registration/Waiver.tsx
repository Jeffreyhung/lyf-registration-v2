import React from "react"
import {
  Button,
  Container,
  Drawer,
  DrawerProps,
  Grid,
  Typography,
} from "@mui/material"

// Local Components
import { TextFieldWithFormValidation } from "@components/Inputs"

// Registration Data Context
import {
  RegistrationDispatchContext,
  RegistrationData,
  RegistrationActionType,
} from "./RegistrationDataContext"

type WaiverProps = DrawerProps & {
  camper: RegistrationData["campers"][0]
  camperIndex: number
  setWaiverOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export default function Waiver({
  camper,
  camperIndex,
  setWaiverOpen,
  ...rest
}: WaiverProps) {
  const dispatch = React.useContext(RegistrationDispatchContext)
  const editCamperHandler =
    (keyToChange: string) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: RegistrationActionType.EditCamper,
        index: camperIndex,
        keyToChange,
        newValue: event.target.value,
      })

  return (
    <Drawer {...rest}>
      <Container maxWidth="md">
        <Grid
          container
          spacing={2}
          sx={{
            padding: { xs: 2, md: 3 },
          }}
          justifyContent="center"
        >
          <Grid size={12}>
            <Typography variant="h4">Waiver</Typography>
          </Grid>
          <Grid size={12}>
            <Typography variant="h6" textAlign="center">
              Liability Release Waiver for Taiwanese American Citizen
              League&nbsp;
            </Typography>
          </Grid>

          <Grid size={12}>
            <Typography variant="body1">
              I, the undersigned, hereby grant permission for the below-named
              participant to attend the Taiwanese American Citizens League -
              Leading Youth Forward Camp and to fully participate in the
              activities thereof. I consent to have pictures and/or video taken
              during TACL-LYF Camp of the below named participant to be printed
              or posted on the internet for advertising, distribution, or other
              camp-related purposes. In order that the below named participant
              may receive necessary medical treatment in the event of injury or
              illness, I understand that an effort will be made to contact me
              immediately and hereby authorize any adult person, being an
              officer, staff member or volunteer of the TACL-LYF Camp, to treat
              or diagnose the below-named participant. As the parent or legal
              guardian of the below named participant, I am responsible for the
              health care decision of such participant and am authorized to
              consent to the services to be rendered. I agree to pay for the
              care of the below named participant and represent that my consent
              and agreement are legal and that no consent from any other person
              is required by law. I hereby release and agree to hold harmless
              TACL, the TACL-LYF Camp, Alliance Redwoods Conference Grounds, and
              each of its officers, directors, employees, staff members, and
              volunteers from any and all liability arising out of personal
              injury, property damage or loss, or wrongful death resulting from:
              (i) the exercise of the authority granted herein, (ii) the below
              named participant's participation in the TACL-LYF Camp, and (iii)
              the negligence, both persuasive and active, or other acts, by any
              of the releases. I hereby waive, discharge, and relinquish any
              action or causes of action which may hereafter arise out of such
              liability, whether known or unknown. I also consent to the
              immediate expulsion of the below-named participant from the
              TACL-LYF Camp for unauthorized excursions outside of the Alliance
              Redwoods Conference Grounds.
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }} sx={{ paddingTop: 3 }}>
            <TextFieldWithFormValidation
              required
              id="waiver-camper-full-name"
              label="Participant (camper) Full Name (print)"
              fullWidth
              value={camper.waiverFullName}
              onChange={editCamperHandler("waiverFullName")}
            />
          </Grid>

          {/* Here to force new line */}
          <Grid
            size={{ xs: 12, md: 6 }}
            sx={{ display: { xs: "none", md: "block" } }}
          />

          <Grid size={{ xs: 12, md: 6 }}>
            <TextFieldWithFormValidation
              required
              id="waiver-signature"
              label="Parent/Guardian Electronic Signature"
              fullWidth
              value={camper.waiverSignature}
              onChange={editCamperHandler("waiverSignature")}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextFieldWithFormValidation
              required
              id="waiver-sign-date"
              label="Date"
              fullWidth
              type="date"
              // So that the text doesn't overlap
              InputLabelProps={{ shrink: true }}
              value={camper.waiverSignDate}
              onChange={editCamperHandler("waiverSignDate")}
            />
          </Grid>

          <Grid size={6}>
            <Button
              fullWidth
              color="primary"
              variant="contained"
              onClick={() => setWaiverOpen(false)}
              disabled={
                !camper.waiverFullName ||
                !camper.waiverSignature ||
                !camper.waiverSignDate
              }
            >
              Submit
            </Button>
          </Grid>
        </Grid>
      </Container>
    </Drawer>
  )
}
