import React from "react"
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  GridProps,
} from "@mui/material"
import FormHasValidatedContext from "./FormHasValidatedContext"

type FormCheckboxGroupProps = {
  value: string[] | null | undefined
  setValue: (newValue: string[]) => void
  options: string[]
  size: GridProps["size"]
  id: string
  label: string
  required?: boolean
  disabled?: boolean
}

export default function FormCheckboxGroup({
  value = [],
  setValue,
  options,
  size,
  id,
  label,
  required,
  disabled,
}: FormCheckboxGroupProps) {
  const formHasValidated = React.useContext(FormHasValidatedContext)
  const formValidationError = required && formHasValidated && value.length === 0

  return (
    <FormControl
      id={`checkbox-group-${id}`}
      // Hack className to show if a checkbox group is required and empty.
      className={required && value.length === 0 ? "checkbox-group-empty" : ""}
      required={required}
      error={formValidationError}
      disabled={disabled}
    >
      <FormLabel id={id}>{label}</FormLabel>
      <Grid container>
        {options.map((option) => (
          <Grid size={size} key={`${id}-${option}`}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={value.includes(option)}
                  disabled={disabled}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setValue([...value, option])
                    } else {
                      setValue(value.filter((item) => item !== option))
                    }
                  }}
                />
              }
              label={option}
            />
          </Grid>
        ))}
      </Grid>
    </FormControl>
  )
}
