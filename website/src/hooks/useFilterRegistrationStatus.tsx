import React from "react"
import {
  Box,
  Chip,
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  SelectChangeEvent,
} from "@mui/material"

import { RegistrationData } from "./useRegistrations"
import { RegistrationStatus } from "lyf-registration-schemas"

const allRegistrationStatuses = Object.values(RegistrationStatus)

const countStatus = (data: RegistrationData[]) => {
  const countDict = new Map()
  data.forEach(({ status }) =>
    countDict.set(status, (countDict.get(status) ?? 0) + 1)
  )

  return countDict
}

export default function useFilterRegistrationStatus(
  data: RegistrationData[],
  defaultStatus: RegistrationStatus[] = [RegistrationStatus.ACTIVE]
): [RegistrationData[], React.ReactElement] {
  const [statuses, setStatuses] = React.useState<string[]>(defaultStatus)
  const handleChange = (event: SelectChangeEvent<typeof statuses>) => {
    const stat = event.target.value
    setStatuses(
      // On autofill we get a stringified value.
      typeof stat === "string" ? stat.split(",") : stat
    )
  }

  // Both derive from the loaded registrations and the chosen statuses only;
  // memoised so the grids built from `filtered` keep a stable input across
  // unrelated re-renders (dialog state, row selection).
  const countDict: Map<RegistrationStatus, number> = React.useMemo(
    () => countStatus(data),
    [data]
  )
  const filtered = React.useMemo(
    () => data.filter((reg) => statuses.includes(reg.status)),
    [data, statuses]
  )

  const selectComponent = (
    <FormControl fullWidth>
      <InputLabel id="demographics-multiple-status-label">
        Filter by Registration Status
      </InputLabel>
      <Select<string[]>
        labelId="demographics-multiple-status-label"
        id="demographics-multiple-status"
        multiple
        value={statuses}
        onChange={handleChange}
        input={
          <OutlinedInput
            id="select-multiple-chip"
            label="Filter by Registration Status"
          />
        }
        renderValue={(selected) => (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selected.map((value) => (
              <Chip
                key={value}
                label={`${value} (${countDict.get(
                  value as RegistrationStatus
                )})`}
              />
            ))}
          </Box>
        )}
      >
        {allRegistrationStatuses.map((status) => (
          <MenuItem key={status} value={status}>
            <Checkbox checked={statuses.includes(status)} />
            <ListItemText primary={`${status} (${countDict.get(status)})`} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )

  return [filtered, selectComponent]
}
