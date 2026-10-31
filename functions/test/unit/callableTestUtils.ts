/**
 * Shared plumbing for driving onCall handlers through `.run` in unit tests:
 * a request as the handler sees it after Firebase has verified the ID token,
 * and an assertion for the HttpsError a handler is expected to throw.
 */
import type {CallableRequest} from "firebase-functions/v2/https";
import {HttpsError} from "firebase-functions/v2/https";

/**
 * A CallableRequest from `email` (null for an anonymous caller). Typed as
 * CallableRequest<never> so a deliberately malformed body can be handed to
 * any callable without a cast at each call site.
 */
export function callableRequest(
  data: unknown,
  email: string | null
): CallableRequest<never> {
  return {
    data,
    rawRequest: {},
    auth: email === null ? undefined : {uid: "uid", token: {email}},
  } as unknown as CallableRequest<never>;
}

/**
 * Awaits `promise` and asserts it rejected with an HttpsError carrying
 * `code` (and a message matching `message`, when given). Returns the error.
 */
export async function expectHttpsError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp
): Promise<HttpsError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
  if (message) expect((caught as HttpsError).message).toMatch(message);
  return caught as HttpsError;
}
