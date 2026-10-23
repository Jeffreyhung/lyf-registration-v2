// The code under test logs through firebase-functions, which writes JSON to
// stdout and clutters the jest output. Keep the behaviour, drop the noise.
jest.mock("firebase-functions", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Module-level configuration in src/utils/auth.ts reads these at import time.
// Make the tests independent of whatever the developer's shell has set.
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.ALLOWED_REDIRECT_ORIGINS;
