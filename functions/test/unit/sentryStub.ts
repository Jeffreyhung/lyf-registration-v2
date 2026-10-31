/**
 * A stand-in for "@sentry/node" that keeps the withSentry* wrappers in
 * src/utils/sentry.ts working (scope, span, flush) while recording
 * captureException. Use from a hoisted factory:
 *
 *   jest.mock("@sentry/node", () => jest.requireActual("./sentryStub").sentryStub());
 */
export function sentryStub() {
  const scope = {
    setTag: jest.fn(),
    setTransactionName: jest.fn(),
    setSDKProcessingMetadata: jest.fn(),
    setUser: jest.fn(),
    setContext: jest.fn(),
  };
  return {
    captureException: jest.fn(),
    addBreadcrumb: jest.fn(),
    withIsolationScope: (fn: (s: typeof scope) => unknown) => fn(scope),
    startSpan: (_opts: unknown, fn: () => unknown) => fn(),
    flush: async () => true,
  };
}
