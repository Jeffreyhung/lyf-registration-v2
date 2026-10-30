import React from "react"
import { AppBar, Stack, Toolbar } from "@mui/material"

import SignInMenu from "@components/Auth/SignInMenu"
import { LinkButton } from "@components/Button"
import { ToggleProdContext } from "@components/ProdContext"
import AuthContext from "@components/Auth/AuthContext"

/**
 * This component will be displayed at the top of every page.
 */
export default function Header() {
  const { isAdmin } = React.useContext(AuthContext)
  const isOnTestDomain =
    typeof window !== "undefined" && window?.location?.hostname === "localhost"

  return (
    <AppBar position="static" color={"default"}>
      <Toolbar>
        <Stack
          justifyContent="flex-end"
          alignItems="center"
          direction="row"
          spacing={2}
          sx={{ width: 1, paddingLeft: 4, paddingRight: 4 }}
        >
          {(isAdmin || isOnTestDomain) && (
            <ToggleProdContext label="Test Data" />
          )}
          <LinkButton to="/" color="inherit">
            Home
          </LinkButton>
          <SignInMenu />
        </Stack>
      </Toolbar>
    </AppBar>
  )
}
