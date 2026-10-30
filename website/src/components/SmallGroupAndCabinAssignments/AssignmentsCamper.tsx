import React from "react"
import {
  Divider,
  Grid,
  ListItem,
  ListItemIcon,
  Typography,
} from "@mui/material"
import { DragIndicator } from "@mui/icons-material"
import { useDrag, useDrop } from "react-dnd"
import { animated, config, useSpring } from "@react-spring/web"

import { Camper } from "small-group-pairing"
import { CamperMetadata } from "./SmallGroupContext"
import { ColumnDef } from "./SmallGroupAssignmentsV2"

const AnimatedListItem = animated(ListItem)
const AnimatedDragIndicator = animated(DragIndicator)

type AssignmentsCamperProps = {
  camper: Camper<CamperMetadata>
  columns: ColumnDef[]
}

export default function AssignmentsCamper({
  camper,
  columns,
}: AssignmentsCamperProps) {
  // Mouse Events
  const [isMouseOver, setIsMouseOver] = React.useState(false)

  // Drag and Drop Hooks
  const [canDrag] = React.useState(true)
  const [{ isDragging }, drag] = useDrag({
    type: "camper",
    item: camper,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    canDrag: () => canDrag,
  })
  const [, drop] = useDrop({
    accept: "camper",
  })

  // Styles
  const dragIconStyle = useSpring({
    transform: isMouseOver ? "scale(1)" : "scale(0)",
    config: config.stiff,
    cursor: "grab",
  })
  const listItemStyle = useSpring({
    opacity: isDragging ? 0.5 : 1,
    transform: isDragging ? "scale(0.95)" : "scale(1)",
  })

  return (
    <>
      <Divider sx={{ borderRadius: 1 }} />
      <AnimatedListItem
        disableGutters
        style={listItemStyle}
        onMouseEnter={() => setIsMouseOver(true)}
        onMouseLeave={() => setIsMouseOver(false)}
      >
        {/* @ts-expect-error Node not given a type since ListItemIcon doesn't define one */}
        <ListItemIcon ref={(node) => drag(drop(node))}>
          <AnimatedDragIndicator style={dragIconStyle} />
        </ListItemIcon>
        <Grid container columns={14} sx={{ width: 1 }}>
          {columns.map(({ id, size, textAlign, transform }) => (
            <Grid key={id} size={size}>
              <Typography align={textAlign}>{transform(camper)}</Typography>
            </Grid>
          ))}
        </Grid>
      </AnimatedListItem>
    </>
  )
}
