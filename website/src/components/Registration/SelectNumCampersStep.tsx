import React from "react"
import {
  Box,
  FormControl,
  FormLabel,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material"

// Local Components
import { NumberInputWithFormValidation } from "@components/Inputs"
import { RegistrationDocumentWithCamperId } from "@hooks/useFamilyData"
import { CamperRegSVG } from "@components/SVG"
import RegistrationStep from "./RegistrationStep"

// Registration Data Context
import {
  RegistrationDataContext,
  RegistrationDispatchContext,
  RegistrationActionType,
} from "./RegistrationDataContext"
import { Star } from "@mui/icons-material"

type SelectNumCampersStepProps = {
  preRegistrations: RegistrationDocumentWithCamperId[]
  campYear: number
}

export default function SelectNumCampersStep({
  preRegistrations,
  campYear,
}: SelectNumCampersStepProps) {
  const registrationData = React.useContext(RegistrationDataContext)
  const dispatch = React.useContext(RegistrationDispatchContext)
  return (
    <RegistrationStep
      title="Camper Registration"
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
      primaryButtonText="Next"
      secondaryButtonText="Back"
    >
      <Grid size={12} sx={{ paddingTop: 8, paddingBottom: 8 }}>
        <FormControl fullWidth>
          <FormLabel id="camper-num-register" sx={{ paddingBottom: 1 }}>
            How many campers will you be registering today?
          </FormLabel>
          <NumberInputWithFormValidation
            required
            aria-labelledby="camper-num-register"
            min={1}
            max={10}
            value={registrationData.campers.length}
            onChange={(_event, val) =>
              dispatch({
                type: RegistrationActionType.SetNumOfCampers,
                numOfCampers: val,
              })
            }
          />
        </FormControl>
      </Grid>
      {preRegistrations.length > 0 && (
        <Grid size={12}>
          <Typography variant="h6">
            {campYear} Pre-Registered Campers
          </Typography>
          <List>
            {preRegistrations.map((reg) => (
              <ListItem key={reg.id}>
                <ListItemIcon>
                  {/* @ts-expect-error We do actually allow tertiary because it's a value in our app palette but the type isn't augmented */}
                  <Star color="tertiary" />
                </ListItemIcon>
                <ListItemText primary={reg.camperName} />
              </ListItem>
            ))}
          </List>
        </Grid>
      )}
    </RegistrationStep>
  )
}
