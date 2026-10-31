import React from "react"
import { Box } from "@mui/material"

export default function TriangleBorder() {
  return (
    <Box
      sx={{
        height: "100vh",
        width: "100vw",
        position: "fixed",
        zIndex: -1000,
        transition: "opacity 3s",
        transitionTimingFunction: "ease-out",
        opacity: 1,
        top: 0,
        left: 0,
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
        }}
      >
        <svg
          width="464"
          height="720"
          viewBox="0 0 464 720"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 0H464L0 720V0Z" fill="#FFC3DA" fillOpacity="0.4" />
        </svg>
      </div>
      <div
        style={{
          position: "fixed",
          bottom: -5,
          left: 0,
        }}
      >
        <svg
          width="399"
          height="533"
          viewBox="0 0 399 533"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M-19.9996 0L398.29 533H-20L-19.9996 0Z"
            fill="#A2E8E5"
            fillOpacity="0.5"
          />
        </svg>
      </div>
      <div
        style={{
          position: "fixed",
          bottom: -5,
          right: 0,
        }}
      >
        <svg
          width="252"
          height="578"
          viewBox="0 0 252 578"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M251.5 0V577.5H0L251.5 0Z"
            fill="#FFE6A7"
            fillOpacity="0.5"
          />
        </svg>
      </div>
    </Box>
  )
}
