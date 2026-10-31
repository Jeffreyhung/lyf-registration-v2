import React from "react"
import { Card, CardContent, CardHeader, Grid } from "@mui/material"
import { RegistrationData } from "@hooks/useRegistrations"
import { RegistrationStatus } from "lyf-registration-schemas"
import SmallGroup from "./SmallGroup"

type SmallGroupAssignmentsProps = {
  registrations: RegistrationData[]
}

const MAX_SMALL_GROUP_SIZE = 12
const TOTAL_NUMBER_OF_GRADES = 13 // K-12, inclusive
const UPPER_CASE_A_CHAR_CODE = "A".charCodeAt(0)

const calculateNumCampersPerGroup = (numCampers: number, numGroups: number) =>
  Math.max(Math.floor(numCampers / numGroups), 1)

export default function SmallGroupAssignments({
  registrations,
}: SmallGroupAssignmentsProps) {
  const activeRegistrations = registrations.filter(
    ({ status }) => status === RegistrationStatus.ACTIVE
  )

  // Bucket campers by grade first
  const grades = Array.from(Array(TOTAL_NUMBER_OF_GRADES), () => ({
    boys: [] as RegistrationData[],
    girls: [] as RegistrationData[],
    nonBinary: [] as RegistrationData[],
    numCampers: 0,
  }))
  activeRegistrations.forEach((registration) => {
    const { gender, grade } = registration

    if (gender?.length !== 1) {
      grades[grade].nonBinary.push(registration)
    } else if (gender[0] === "Female") {
      grades[grade].girls.push(registration)
    } else if (gender[0] === "Male") {
      grades[grade].boys.push(registration)
    }
    grades[grade].numCampers += 1
  })

  const smallGroups: {
    boys: RegistrationData[]
    girls: RegistrationData[]
    nonBinary: RegistrationData[]
  }[] = []
  grades.forEach(({ boys, girls, nonBinary, numCampers }) => {
    const groupsForThisGrade: typeof smallGroups = []

    // Split grade groups evenly by gender if there are too many campers
    const numGroups = Math.ceil(numCampers / MAX_SMALL_GROUP_SIZE)
    const [numGirlsPerGroup, numBoysPerGroup, numNonBinaryCampersPerGroup] = [
      girls,
      boys,
      nonBinary,
    ].map((campers) => calculateNumCampersPerGroup(campers.length, numGroups))
    for (let i = 0; i < numGroups; i++) {
      groupsForThisGrade.push({
        boys: boys.slice(i * numBoysPerGroup, (i + 1) * numBoysPerGroup),
        girls: girls.slice(i * numGirlsPerGroup, (i + 1) * numGirlsPerGroup),
        nonBinary: nonBinary.slice(
          i * numNonBinaryCampersPerGroup,
          (i + 1) * numNonBinaryCampersPerGroup
        ),
      })
    }

    // round-robin distribute remaining campers
    const leftoverBoys = boys.slice(numBoysPerGroup * numGroups)
    leftoverBoys.forEach((boy, index) => {
      groupsForThisGrade[index].boys.push(boy)
    })
    const leftoverGirls = girls.slice(numGirlsPerGroup * numGroups)
    leftoverGirls.forEach((girl, index) => {
      groupsForThisGrade[numGroups - index - 1].girls.push(girl)
    })

    // append groups for this grade to finalized small groups
    groupsForThisGrade.forEach((group) => {
      smallGroups.push(group)
    })
  })

  return (
    <>
      <Card elevation={0}>
        <CardHeader
          title="Small Group Assignments"
          titleTypographyProps={{
            align: "center",
            variant: "h4",
          }}
        />
        <CardContent>
          <Grid container spacing={2}>
            {smallGroups.map(({ boys, girls, nonBinary }, groupIndex) => {
              const groupName = String.fromCharCode(
                groupIndex + UPPER_CASE_A_CHAR_CODE
              )

              return (
                <Grid size={6} key={groupName}>
                  <SmallGroup
                    name={groupName}
                    boys={boys}
                    girls={girls}
                    nonBinary={nonBinary}
                  />
                </Grid>
              )
            })}
          </Grid>
        </CardContent>
      </Card>
    </>
  )
}
