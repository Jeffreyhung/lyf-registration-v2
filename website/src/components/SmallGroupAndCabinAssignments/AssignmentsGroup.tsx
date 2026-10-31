import React from "react"
import {
  Collapse,
  Grid,
  Typography,
  List,
  Divider,
  ListItemButton,
  Chip,
  Stack,
} from "@mui/material"
import { KeyboardArrowDown, KeyboardArrowUp } from "@mui/icons-material"
import { useDrop } from "react-dnd"
import { animated, useSpring } from "@react-spring/web"

import { UNASSIGNED_GROUP_ID } from "small-group-pairing"

import {
  PairingCamper,
  PairingGroup,
  SmallGroupDispatchContext,
  SmallGroupActionType,
} from "./SmallGroupContext"
import { ColumnDef } from "./SmallGroupAssignmentsV2"
import AssignmentsCamper from "./AssignmentsCamper"

type AssignmentsGroupProps = {
  group: PairingGroup
  columns: ColumnDef[]
}

type DragAndDropMonitor = {
  isOver: boolean
}

export default function AssignmentsGroup({
  group,
  columns,
}: AssignmentsGroupProps) {
  const dispatch = React.useContext(SmallGroupDispatchContext)
  const [isOpen, setIsOpen] = React.useState(false)
  const [{ isOver }, drop] = useDrop<PairingCamper, void, DragAndDropMonitor>({
    accept: "camper",
    drop: (c) => {
      if (c.groupId == group.id) return

      dispatch({
        type: SmallGroupActionType.SetGroup,
        camper: c,
        groupId: group.id,
        prevGroupId: c.groupId,
      })

      setIsOpen(true)
    },

    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  })
  const campers = Array.from(group.members)

  const groupName =
    group.id != UNASSIGNED_GROUP_ID ? `Group: ${group.id}` : `No group`

  const backgroundStyle = useSpring({
    backgroundColor: isOver ? "rgba(0,0,0,0.1)" : "transparent",
  })

  return (
    <animated.div ref={drop} style={backgroundStyle}>
      <ListItemButton disableGutters onClick={() => setIsOpen(!isOpen)}>
        <Grid
          container
          columns={14}
          sx={{ width: 1 }}
          justifyContent={"space-between"}
        >
          <Grid size={8}>
            <Stack direction="row" spacing={1}>
              {isOpen ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
              <Typography align="left">{groupName}</Typography>
              {group.id == UNASSIGNED_GROUP_ID && (
                <Chip color="primary" size="small" label={group.members.size} />
              )}
            </Stack>
          </Grid>
          <Grid size={6}>
            <Typography
              align="left"
              sx={{
                fontFamily: "IBM Plex Mono, monospace",
              }}
            >
              Total: {group.members.size}, Female: 0, Male: 0, Non-binary: 0
            </Typography>
          </Grid>
        </Grid>
      </ListItemButton>
      <Collapse in={isOpen || isOver}>
        <List dense disablePadding>
          {campers.map((c) => (
            <AssignmentsCamper key={c.id} camper={c} columns={columns} />
          ))}
        </List>
      </Collapse>
      <Divider />
    </animated.div>
  )
}
