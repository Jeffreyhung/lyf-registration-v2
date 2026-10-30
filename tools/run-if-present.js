#!/usr/bin/env node
/**
 * Run a workspace's package.json script only if the workspace defines it.
 *
 *   node tools/run-if-present.js <workspace-dir> <script> [args...]
 *
 * Yarn 1 has no `--if-present`. The root scripts and CI fan out to workspace
 * scripts (website lint/test) that are being added incrementally; this lets
 * them stay green until every workspace has the script. A missing script
 * prints a note and exits 0; a present one runs through
 * `yarn --cwd <workspace-dir> run <script>` and its exit status is returned.
 */
const { spawnSync } = require("child_process")
const { existsSync, readFileSync } = require("fs")
const path = require("path")

const [dir, script, ...args] = process.argv.slice(2)
if (!dir || !script) {
  console.error(
    "usage: node tools/run-if-present.js <workspace-dir> <script> [args...]"
  )
  process.exit(2)
}

const manifestPath = path.resolve(__dirname, "..", dir, "package.json")
if (!existsSync(manifestPath)) {
  console.error(`run-if-present: ${manifestPath} not found`)
  process.exit(2)
}

const scripts = JSON.parse(readFileSync(manifestPath, "utf8")).scripts ?? {}
if (!scripts[script]) {
  console.log(`run-if-present: ${dir} has no "${script}" script, skipping`)
  process.exit(0)
}

const result = spawnSync("yarn", ["--cwd", dir, "run", script, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
})
process.exit(result.status ?? 1)
