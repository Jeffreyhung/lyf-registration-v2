import React from "react"
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
} from "@mui/material"

import { AnimatedButton } from "@components/Button"
import {
  SmallGroupActionType,
  SmallGroupDispatchContext,
} from "./SmallGroupContext"
import { GroupId } from "small-group-pairing"

export default function AddGroupButton() {
  const dispatch = React.useContext(SmallGroupDispatchContext)
  const [isOpen, setIsOpen] = React.useState(false)
  const [groupId, setGroupId] = React.useState<GroupId>(null)

  const handleOpen = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    setIsOpen(false)
    setGroupId(null)
  }

  const handleAddGroup = () => {
    dispatch({ type: SmallGroupActionType.AddGroup, groupId: groupId })
    handleClose()
  }

  return (
    <>
      <AnimatedButton
        fullWidth
        variant="contained"
        boopProps={{ scale: 1.05 }}
        onClick={handleOpen}
      >
        Add Group
      </AnimatedButton>
      <Dialog open={isOpen} onClose={handleClose}>
        <DialogTitle>Add Group</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ paddingTop: 2, paddingBottom: 2 }}>
            <Grid size={12}>
              <TextField
                id="add-group-id"
                label="Group Letter"
                fullWidth
                value={groupId}
                onChange={(event) => setGroupId(event.target.value as GroupId)}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <AnimatedButton
            autoFocus
            onClick={handleClose}
            boopProps={{
              scale: 1.05,
            }}
          >
            Cancel
          </AnimatedButton>
          <AnimatedButton
            variant="contained"
            onClick={handleAddGroup}
            disabled={groupId == null}
            boopProps={{
              scale: 1.05,
            }}
          >
            Add
          </AnimatedButton>
        </DialogActions>
      </Dialog>
    </>
  )
}
