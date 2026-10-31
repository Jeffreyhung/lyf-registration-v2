import React from "react"
import { Link } from "gatsby"

import AnimatedButton, {AnimatedButtonProps} from "./AnimatedButton"
import { LinkButtonProps } from "./LinkButton"

type AnimatedLinkButtonProps = AnimatedButtonProps & LinkButtonProps

const AnimatedLinkButton = React.forwardRef<HTMLElement, AnimatedLinkButtonProps>(
  ({ to, ...rest }, ref) => (
    <AnimatedButton
      component={to ? Link : "button"}
      to={to && to.charAt(0) != "/" ? `/${to}` : to}
      // @ts-expect-error Ref type weirdness
      ref={ref}
      {...rest}
    />
  )
)
AnimatedLinkButton.displayName = "AnimatedLinkButton"

export default AnimatedLinkButton
