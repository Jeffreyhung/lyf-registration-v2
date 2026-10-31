import React from "react"
import { Grid } from "@mui/material"

import { RegistrationData } from "@hooks/useRegistrations"
import DemographicsChart from "./DemographicsChart"
import { RegistrationStatus } from "lyf-registration-schemas"
import useFilterRegistrationStatus from "@hooks/useFilterRegistrationStatus"

type DemographicsProps = {
  data: RegistrationData[]
}

export default function Demographics({ data }: DemographicsProps) {
  const [filteredData, selectComponent] = useFilterRegistrationStatus(data, [
    RegistrationStatus.ACTIVE,
  ])

  const grades = filteredData.map((reg) =>
    reg.grade > 3 ? `${reg.grade}th` : "3rd"
  )
  const gender = filteredData.map((reg) => reg.gender?.join(", "))

  const demographics = filteredData.map((reg) => reg.demographics)

  return (
    <Grid container spacing={1} rowSpacing={1} justifyContent="center">
      <Grid size={8}>{selectComponent}</Grid>
      <Grid size={6}>
        <DemographicsChart data={grades} title="Campers by Grade" />
      </Grid>
      <Grid size={6}>
        <DemographicsChart data={gender} title="Campers by Gender" />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) => (d ? d.born : null))}
          title="Where was your camper born?"
        />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) =>
            d?.ethnicity ? d.ethnicity?.join(", ") : null
          )}
          title="What ethnicity is your camper?"
        />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) => (d ? d.generation : null))}
          title="Generation"
        />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) => (d ? d.mandarinLanguage : null))}
          title="Mandarin Fluency"
        />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) => (d ? d.hokkienLanguage : null))}
          title="Hokkien Fluency"
        />
      </Grid>
      <Grid size={4}>
        <DemographicsChart
          data={demographics.flatMap((d) => (d ? d.hakkaLanguage : null))}
          title="Hakka Fluency"
        />
      </Grid>
    </Grid>
  )
}
