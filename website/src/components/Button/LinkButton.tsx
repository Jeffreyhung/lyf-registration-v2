import React from "react"
import { Button, ButtonProps } from "@mui/material"
import { Link } from "gatsby"

export type LinkButtonProps = ButtonProps & {
  to?: string
}

const LinkButton = React.forwardRef<HTMLElement, LinkButtonProps>(
  ({ to, ...rest }, ref) => (
    <Button
      component={to ? Link : "button"}
      to={to && to.charAt(0) != "/" ? `/${to}` : to}
      ref={ref}
      {...rest}
    />
  )
)
LinkButton.displayName = "LinkButton"

export default LinkButton
