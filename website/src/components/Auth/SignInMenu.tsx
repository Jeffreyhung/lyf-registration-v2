"use client"

// use client above is important since it tells Gatsby that this component should NOT be rendered on the server
// and it'll be re-hydrated later once the code is running in a browser: https://www.gatsbyjs.com/docs/how-to/performance/partial-hydration/

import React from "react"
import { navigate } from "gatsby"
import { signOut } from "firebase/auth"
import { Avatar, IconButton, Menu, MenuItem } from "@mui/material"

import AuthContext from "./AuthContext"
import useAnchorElement from "@hooks/useAnchorElement"
import { firebaseAuth } from "@utils/firebaseApp"
import { clearSavedRegistration } from "@components/Registration/RegistrationDataContext"

export default function SignInMenu() {
  const { isSignedIn, user, isAdmin } = React.useContext(AuthContext)
  const [anchorEl, isOpen, handleClick, handleClose] = useAnchorElement()

  return (
    <>
      <IconButton onClick={handleClick}>
        <Avatar
          sx={{
            bgcolor: "primary.main",
          }}
        >
          {user && user.email && user.email.charAt(0).toUpperCase()}
        </Avatar>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={isOpen}
        onClose={handleClose}
        onClick={handleClose}
      >
        {!isSignedIn && (
          <MenuItem onClick={() => navigate("/login")}>Sign In</MenuItem>
        )}
        {isAdmin && (
          <MenuItem onClick={() => navigate("/admin")}>
            Admin Dashboard
          </MenuItem>
        )}
        {isSignedIn && (
          <MenuItem onClick={() => navigate("/user/profile")}>User Profile</MenuItem>
        )}
        {isSignedIn && (
          <MenuItem onClick={() => {
            clearSavedRegistration()
            window.localStorage.removeItem("emailForSignIn")
            window.localStorage.removeItem("user_id")
            window.localStorage.removeItem("campYear")
            signOut(firebaseAuth)
          }}>Sign Out</MenuItem>
        )}
      </Menu>
    </>
  )
}
