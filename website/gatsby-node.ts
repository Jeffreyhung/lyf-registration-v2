/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/
 */
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import tsconfig from "./tsconfig.json"
import type { GatsbyNode } from "gatsby"
import { buildSecurityHeaders } from "./src/utils/csp"

dotenv.config({ path: `.env` })

const trimString = (str: string) => str.substring(0, str.length - 2)

// Takes in paths defined in tsconfig.json, strips them of * and then adds them as webpack aliases
export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] = ({
  actions,
}) => {
  const aliases: Record<string, string[]> = tsconfig.compilerOptions.paths
  const webpackAliases: Record<string, string> = {}
  for (const key in aliases) {
    const value = trimString(aliases[key][0])
    webpackAliases[trimString(key)] = path.isAbsolute(value)
      ? value
      : path.resolve(value)
  }
  actions.setWebpackConfig({
    resolve: {
      alias: webpackAliases,
    },
  })
}

// Netlify applies response headers from a `_headers` file in the publish
// directory; GitHub Pages ignores the file. The CSP in it is the same policy
// the <meta> tag in gatsby-ssr.tsx enforces (see src/utils/csp.ts), sent as
// report-only with a report-uri so violations reach Sentry.
export const onPostBuild: GatsbyNode["onPostBuild"] = async ({
  store,
  reporter,
}) => {
  const { program } = store.getState()
  const headerLines = Object.entries(buildSecurityHeaders()).map(
    ([name, value]) => `  ${name}: ${value}`
  )
  const target = path.join(program.directory, "public", "_headers")
  await fs.promises.writeFile(target, ["/*", ...headerLines, ""].join("\n"))
  reporter.info(
    `Wrote security headers to ${path.relative(program.directory, target)}`
  )
}
