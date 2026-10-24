/**
 * Implement Gatsby's SSR APIs in this file.
 *
 * See: https://www.gatsbyjs.com/docs/ssr-apis/
 */
import React from "react"

import { Providers, Layout } from "./src/components/App"
import { buildCspMetaContent } from "./src/utils/csp"

export const onRenderBody = ({ setHtmlAttributes, setHeadComponents }) => {
  setHtmlAttributes({ lang: "en" })
  // The enforced policy. The same directives are also emitted as a report-only
  // response header for Netlify in gatsby-node.ts; edit them in src/utils/csp.ts.
  setHeadComponents([
    <meta
      key="csp"
      httpEquiv="Content-Security-Policy"
      content={buildCspMetaContent()}
    />,
  ])
}

export const wrapRootElement = ({ element }) => <Providers>{element}</Providers>
export const wrapPageElement = ({ element }) => <Layout>{element}</Layout>
