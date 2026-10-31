// A module (not a script) so the declarations below augment MUI instead of
// replacing it.
export {}

declare module "@mui/material/styles" {
  interface Palette {
    tertiary: Palette["primary"]
    gray: string,
    lightgray: string,
    offwhite: string,
  }

  interface PaletteOptions {
    tertiary: PaletteOptions["primary"]
    gray: string,
    lightgray: string,
    offwhite: string,
  }

  interface BreakpointOverrides {
    xs: true;
    sm: true;
    md: true;
    lg: true;
    xl: true;
    xxl: true;
  }
}
