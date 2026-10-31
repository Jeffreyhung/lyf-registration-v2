/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Unit tests live under test/unit; test/*.js are the emulator smoke scripts.
  testMatch: ["<rootDir>/test/unit/**/*.test.ts"],
  setupFiles: ["<rootDir>/test/unit/setup.ts"],
  // Compiles src/emailTemplates/*.mjml -> .html once per run (see the file).
  globalSetup: "<rootDir>/test/unit/globalSetup.js",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {tsconfig: "<rootDir>/tsconfig.test.json"}],
  },
  // lib/ is tsc output and isolate/ is the deploy bundle; never run tests from there.
  modulePathIgnorePatterns: ["<rootDir>/lib/", "<rootDir>/isolate/"],
};
