import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import pluginReact from "eslint-plugin-react"
import pluginReactHooks from "eslint-plugin-react-hooks"
import { defineConfig } from "eslint/config"

export default defineConfig([
  // Build output, Gatsby's cache and its generated GraphQL typings.
  { ignores: ["public/", ".cache/", "dist/", "src/gatsby-types.d.ts"] },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    plugins: { js },
    extends: ["js/recommended"],
    // gatsby-node.ts / gatsby-config.ts run in Node, the rest in the browser.
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    // Set explicitly: "detect" calls context.getFilename, which ESLint 10
    // removed, and crashes the react plugin.
    settings: { react: { version: "18.3" } },
    plugins: { "react-hooks": pluginReactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Most of the existing effects are intentionally mount-only; each one is
      // listed in docs/website-strict-mode.md rather than silenced here.
      "react-hooks/exhaustive-deps": "warn",
      // Props are typed with TypeScript.
      "react/prop-types": "off",
      // Apostrophes and quotes in prose; escaping them adds nothing.
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          // `_` prefix is the tsc noUnusedParameters convention...
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          // ...and `const { ref, ...rest } = doc` is how Firestore fields are
          // stripped before an object is sent to a function.
          ignoreRestSiblings: true,
        },
      ],
      // Existing `any`s (grid cell params, reducer payloads) are tracked in
      // docs/website-strict-mode.md; new ones should not be added.
      "@typescript-eslint/no-explicit-any": "warn",
      // Stray debug output; warn/error are the deliberate channels.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["test/unit/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
])
