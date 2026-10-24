/**
 * Implement Gatsby's Browser APIs in this file.
 *
 * See: https://www.gatsbyjs.com/docs/browser-apis/
 */
import React from "react"

import { Providers, Layout } from "./src/components/App"
import { SENTRY_DSN } from "./src/utils/sentry"

import * as Sentry from "@sentry/gatsby"

Sentry.init({
  dsn: SENTRY_DSN,
})

// Import all the font variants
import "@fontsource/nunito/800.css"
import "@fontsource/nunito/700.css"

export const wrapRootElement = ({ element }) => <Providers>{element}</Providers>
export const wrapPageElement = ({ element }) => <Layout>{element}</Layout>
