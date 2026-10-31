import React from "react"
import { Card, CardActionArea, Stack, Typography } from "@mui/material"
import { animated } from "@react-spring/web"

// Utils
import { CamperWithRegistration } from "./CamperCheckoutFlow"
import useBoop from "@hooks/useBoop"

const AnimatedCard = animated(Card)

// I want to eventually pass through context but oh well
type CamperSelectionProps = {
  camper: CamperWithRegistration
  preRegisteredCampersIds: string[]
  setPreRegisteredCampersIds: React.Dispatch<string[]>
}

export default function CamperSelection({
  camper,
  preRegisteredCampersIds,
  setPreRegisteredCampersIds,
}: CamperSelectionProps) {
  const isActiveThisYear = camper.isActiveThisYear
  const isAlreadyPreRegistered = camper.isPreRegisteredForNextYear
  const isSelected = preRegisteredCampersIds.includes(camper.id)

  const [boopStyles, trigger] = useBoop({ scale: 1.01, rotation: 0.3 })

  const handleClick = () => {
    trigger()
    setPreRegisteredCampersIds(
      isSelected
        ? preRegisteredCampersIds.filter((id) => id !== camper.id)
        : [...preRegisteredCampersIds, camper.id]
    )
  }

  return (
    <Stack
      alignItems="center"
      sx={{ width: 1, height: 1 }}
      direction={{
        xs: "row",
        lg: "column",
      }}
    >
      <AnimatedCard
        variant="outlined"
        style={boopStyles}
        sx={{
          borderColor: isSelected ? "primary.main" : "lightgray",
          backgroundColor: isAlreadyPreRegistered ? "lightgray" : "white",
          borderWidth: 2,
          borderRadius: 2,
          width: 1,
          height: 1,
        }}
      >
        <CardActionArea
          onClick={handleClick}
          disabled={isAlreadyPreRegistered}
          sx={{
            padding: 4,
            height: 1,
          }}
        >
          <Typography variant="h6" textAlign="center">
            {`${camper.firstName} ${camper.lastName}`}
          </Typography>
          {isAlreadyPreRegistered && (
            <Typography textAlign="center">Already Pre-Registered</Typography>
          )}
          {!isActiveThisYear && (
            <Typography textAlign="center">Did Not Attend This Year</Typography>
          )}
        </CardActionArea>
      </AnimatedCard>
    </Stack>
  )
}
