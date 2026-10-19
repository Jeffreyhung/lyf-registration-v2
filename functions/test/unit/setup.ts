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
