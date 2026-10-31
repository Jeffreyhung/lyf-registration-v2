import React from "react"
import {
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  ListItemText,
  Stack,
  StackProps,
  Typography,
  useTheme,
  useMediaQuery,
  TextField,
  MenuItem,
  CircularProgress,
} from "@mui/material"
import { AddCircle } from "@mui/icons-material"
import { Dayjs } from "dayjs"

// Utils
import { Camper } from "@utils/databaseSchema"
import { CamperHealth } from "lyf-registration-schemas"
import { CollectionReference, addDoc, doc, setDoc } from "firebase/firestore"
import { SnackbarAlertContext } from "@components/SnackbarAlert"

const genderOptions = [
  "Male",
  "Female",
  "Transgender",
  "Genderqueer/Gender non-conforming",
  "Prefer Not to Say",
  "Something Else",
]

const birthDateFormat = "YYYY-MM-DD"

type AddCamperProps = StackProps & {
  familyCampersRef: CollectionReference | null | undefined
}

enum AddCamperActions {
  Reset = -1,
  EditFirstName = 0,
  EditLastName = 1,
  EditBirthDate = 2,
  EditEmail = 3,
  EditGender = 4,
  EditDiet = 5,
  EditMedical = 6,
}

type AddCamperActionType = {
  type: AddCamperActions
  value: string | string[] | Dayjs
}

type CamperWithoutDocumentId = Omit<Camper, "ref" | "id"> & CamperHealth

function addCamperReducer(
  state: CamperWithoutDocumentId,
  action: AddCamperActionType
): CamperWithoutDocumentId {
  switch (action.type) {
    case AddCamperActions.EditFirstName:
      return {
        ...state,
        firstName: action.value as string,
      }
    case AddCamperActions.EditLastName:
      return {
        ...state,
        lastName: action.value as string,
      }
    case AddCamperActions.EditBirthDate:
      return {
        ...state,
        birthDate: action.value as string,
      }
    case AddCamperActions.EditEmail:
      return {
        ...state,
        email: action.value as string,
      }
    case AddCamperActions.EditGender:
      return {
        ...state,
        gender: action.value as string[],
      }
    case AddCamperActions.EditDiet:
      return {
        ...state,
        dietAndFoodAllergies: action.value as string,
      }
    case AddCamperActions.EditMedical:
      return {
        ...state,
        medicalConditions: action.value as string,
      }
    case AddCamperActions.Reset:
      return createInitialCamper()
  }
}

function createInitialCamper(): CamperWithoutDocumentId {
  return {
    firstName: "",
    lastName: "",
    birthDate: "",
    email: "",
    gender: [],
    dietAndFoodAllergies: "",
    medicalConditions: "",
    registrations: [],
    returning: false,
  }
}

export default function AddCamper({
  familyCampersRef,
  ...rest
}: AddCamperProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { setSnackbar } = React.useContext(SnackbarAlertContext)
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"))
  const handleClose = () => setIsOpen(false)

  const [state, dispatch] = React.useReducer(
    addCamperReducer,
    undefined,
    createInitialCamper
  )
  const handleString =
    (actionType: AddCamperActions) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      dispatch({
        type: actionType,
        value: event.currentTarget.value as string,
      })

  const handleSave = async () => {
    if (!familyCampersRef) {
      return
    }

    if (
      state.firstName === "" ||
      state.lastName === "" ||
      state.birthDate === "" ||
      state.gender?.length === 0
    ) {
      setError("Required fields are missing")
      return
    }

    setIsLoading(true)

    try {
      // Health is role-gated in campers/{id}/private/health; the rules reject
      // health fields on the camper doc itself.
      const { dietAndFoodAllergies, medicalConditions, ...camperProfile } = state
      const camperRef = await addDoc(familyCampersRef, camperProfile)
      await setDoc(doc(camperRef, "private", "health"), {
        dietAndFoodAllergies: dietAndFoodAllergies ?? null,
        medicalConditions: medicalConditions ?? null,
      })
      dispatch({ type: AddCamperActions.Reset, value: "" })
      setIsOpen(false)
      setError(null)
      setSnackbar({
        children: "Successfully added new camper to family",
        severity: "success",
      })
    } catch (error) {
      console.error(error)
      setError("Unable to add new camper. Please try again later.")
    }

    setIsLoading(false)
  }

  return (
    <>
      <Stack
        alignItems="center"
        justifyContent="center"
        direction={{
          xs: "row",
          lg: "column",
        }}
        {...rest}
      >
        <Card
          variant="outlined"
          sx={{
            width: 1,
            height: 1,
            borderWidth: 2,
            borderStyle: "dashed",
            borderRadius: 2,
          }}
        >
          <CardActionArea
            sx={{
              padding: 2,
              height: 1,
            }}
            onClick={() => setIsOpen(true)}
          >
            <Stack alignItems="center" justifyContent="center" spacing={1}>
              <AddCircle color="primary" />
              <Typography variant="h6" textAlign="center">
                Add Additional Siblings
              </Typography>
            </Stack>
          </CardActionArea>
        </Card>
      </Stack>
      <Dialog open={isOpen} keepMounted fullScreen={fullScreen} scroll="paper">
        <DialogTitle>Add New Camper</DialogTitle>
        <DialogContent dividers>
          <Grid
            container
            justifyContent="center"
            alignItems="stretch"
            spacing={1}
          >
            {/* First Name */}
            <Grid size={6}>
              <TextField
                required
                id="camper-first-name"
                label="First Name"
                onChange={handleString(AddCamperActions.EditFirstName)}
                value={state.firstName}
                error={state.firstName === ""}
                fullWidth
              />
            </Grid>

            {/* Last Name */}
            <Grid size={6}>
              <TextField
                required
                id="camper-last-name"
                label="Last Name"
                onChange={handleString(AddCamperActions.EditLastName)}
                value={state.lastName}
                error={state.lastName === ""}
                fullWidth
              />
            </Grid>

            {/* Birthday */}
            <Grid size={12}>
              <TextField
                required
                id="camper-birth-date"
                label="Birthday"
                onChange={handleString(AddCamperActions.EditBirthDate)}
                value={state.birthDate}
                helperText={`Format must be ${birthDateFormat}`}
                error={state.birthDate === ""}
                fullWidth
                type="date"
                // So that the text doesn't overlap
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Gender */}
            <Grid size={12}>
              <TextField
                id="camper-gender"
                select
                label="Gender"
                error={!state.gender || state.gender.length == 0}
                SelectProps={{
                  // @ts-expect-error This thinks it's unknown for some reason
                  renderValue: (selected: string[]) => selected.join(", "),
                  multiple: true,
                }}
                fullWidth
                required
                value={state.gender}
                onChange={(event) => {
                  const {
                    target: { value },
                  } = event
                  dispatch({
                    type: AddCamperActions.EditGender,
                    value: typeof value === "string" ? value.split(",") : value,
                  })
                }}
              >
                {genderOptions.map((gender) => (
                  <MenuItem key={gender} value={gender}>
                    <Checkbox checked={state.gender?.includes(gender)} />
                    <ListItemText primary={gender} />
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            {/* Email */}
            <Grid size={12}>
              <TextField
                id="camper-email-name"
                label="Email"
                onChange={handleString(AddCamperActions.EditEmail)}
                value={state.email}
                fullWidth
              />
            </Grid>

            {/* Diet and Food Allergies */}
            <Grid size={12}>
              <TextField
                id="camper-diet-and-allergies"
                label="Dietary Restrictions and Food Allergies"
                onChange={handleString(AddCamperActions.EditDiet)}
                multiline
                fullWidth
                value={state.dietAndFoodAllergies}
              />
            </Grid>

            {/* Medical Conditions */}
            <Grid size={12}>
              <TextField
                id="camper-medical"
                label="Medical Conditions"
                onChange={handleString(AddCamperActions.EditMedical)}
                multiline
                fullWidth
                value={state.medicalConditions}
              />
            </Grid>

            {error && (
              <Grid size={12}>
                <Typography color="error">{error}</Typography>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={handleClose}>
            Cancel
          </Button>
          <Button
            startIcon={isLoading && <CircularProgress />}
            onClick={handleSave}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
