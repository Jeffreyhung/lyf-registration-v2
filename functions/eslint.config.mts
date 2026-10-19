import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // lib/ is tsc output; isolate/ is the deploy bundle isolate-package generates
  { ignores: ["lib/", "isolate/"] },
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    files: ["test/unit/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ["jest.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);
