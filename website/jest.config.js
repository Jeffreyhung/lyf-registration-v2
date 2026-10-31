/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Unit tests for pure modules live under test/unit. Component tests would
  // need jsdom and @testing-library/react, neither of which is installed.
  testMatch: ["<rootDir>/test/unit/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
  // Mirrors the "paths" aliases in tsconfig.json (webpack gets them from
  // gatsby-node.ts).
  moduleNameMapper: {
    "^@components/(.*)$": "<rootDir>/src/components/$1",
    "^@hooks/(.*)$": "<rootDir>/src/hooks/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
  },
  // public/ and .cache/ are Gatsby output; dist/ is tsc output.
  modulePathIgnorePatterns: [
    "<rootDir>/public/",
    "<rootDir>/.cache/",
    "<rootDir>/dist/",
  ],
}
