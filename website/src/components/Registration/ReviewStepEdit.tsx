import React from "react"
import {
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemTextProps,
  Stack,
} from "@mui/material"

import CheckoutFlowContext from "@components/CheckoutFlow/CheckoutFlowContext"

type ReviewStepEditProps = {
  title: string
  stepIndex?: number
  missingFields?: string[]
  values: {
    key: string
    value: string | number
  }[]
}

export default function ReviewStepEdit({
  title,
  stepIndex,
  missingFields,
  values,
}: ReviewStepEditProps) {
  const { setActiveStep } = React.useContext(CheckoutFlowContext)
  const errorProps: ListItemTextProps =
    missingFields && missingFields.length > 0
      ? {
          secondary: `Missing required fields: ${missingFields.join(", ")}`,
          secondaryTypographyProps: { color: "error" },
        }
      : {}
  return (
    <Stack direction="row" justifyContent="space-between">
      {/* Content */}
      <List>
        <ListItem disablePadding>
          <ListItemText primary={<b>{title}</b>} {...errorProps} />
        </ListItem>
        {values.map(({ key, value }) => (
          <ListItem key={key} disablePadding sx={{ pl: 4 }}>
            <ListItemText
              primary={
                <>
                  <b>{key}: </b>
                  {value}
                </>
              }
            />
          </ListItem>
        ))}
      </List>

      {/* Edit Indicator if present */}
      {stepIndex != null && (
        <Button variant="text" onClick={() => setActiveStep(stepIndex)}>
          Edit
        </Button>
      )}
    </Stack>
  )
}
