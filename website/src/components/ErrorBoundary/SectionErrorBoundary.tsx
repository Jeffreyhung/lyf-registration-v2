import * as React from "react"
import { Alert, AlertTitle, Button } from "@mui/material"
import * as Sentry from "@sentry/gatsby"

type SectionErrorBoundaryProps = React.PropsWithChildren<{
  /** Names what failed in the message, e.g. "the Demographics section". */
  label: string
}>

type SectionErrorBoundaryState = {
  error: Error | null
}

/**
 * webpack raises this when a lazily loaded chunk cannot be fetched. The usual
 * cause is a tab left open across a deploy: the new build has different chunk
 * hashes and the old ones are gone, so the only fix is a reload.
 */
const isChunkLoadError = (error: Error): boolean =>
  error.name === "ChunkLoadError" ||
  /Loading (CSS )?chunk [^ ]+ failed/i.test(error.message)

/**
 * Catches render errors from a lazily loaded section so they do not unmount
 * the whole page. React 18 tears down the entire tree when an error reaches
 * the root, which on a Gatsby page means a blank screen with no way back.
 */
export default class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A stale chunk is a deploy, not a bug; everything else is worth a report.
    if (!isChunkLoadError(error)) {
      Sentry.captureException(error, {
        contexts: { react: { componentStack: info.componentStack } },
      })
    }
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    const stale = isChunkLoadError(error)
    return (
      <Alert
        severity={stale ? "info" : "error"}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        }
      >
        <AlertTitle>
          {stale
            ? "A newer version of the site is available"
            : `Could not load ${this.props.label}`}
        </AlertTitle>
        {stale
          ? "Reload the page to pick up the latest version, then open the section again."
          : error.message}
      </Alert>
    )
  }
}
