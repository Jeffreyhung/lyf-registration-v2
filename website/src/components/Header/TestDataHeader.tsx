import React from "react"
import { AppBar, Container, Toolbar, Typography } from "@mui/material"
import { ProdContext } from "@components/ProdContext"

export default function TestDataHeader() {
  const { isProd } = React.useContext(ProdContext)
  return isProd ? (
    <></>
  ) : (
    <AppBar position="static" color="primary">
      <Toolbar variant="dense">
        <Container maxWidth="sm" disableGutters>
          <Typography variant="h6" textAlign="center">
            Test Mode Enabled
          </Typography>
        </Container>
      </Toolbar>
    </AppBar>
  )
}
