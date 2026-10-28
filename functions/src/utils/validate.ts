import {HttpsError} from "firebase-functions/v2/https";
import {SchemaValidationError, type Validator} from "lyf-registration-schemas";

/**
 * True for the error every `validateX` function in the schemas package
 * throws. `instanceof` is the normal path; the name check covers the case
 * where two copies of the package end up loaded (e.g. jest module isolation).
 */
function isSchemaValidationError(error: unknown): error is SchemaValidationError {
  return (
    error instanceof SchemaValidationError ||
    (error instanceof Error && error.name === "SchemaValidationError")
  );
}

/**
 * Run a schemas-package payload validator over a callable's `request.data`
 * and translate a failure into the `invalid-argument` HttpsError the client
 * expects. The error message lists every issue with its path
 * (e.g. `campers[1].grade: expected int ...`) and the structured issues ride
 * along in `details` for clients that want them. Anything that is not a
 * validation failure is re-thrown untouched.
 *
 * The validated value, not `request.data`, is what handlers should use from
 * then on: the payload validators strip document leftovers (`id`, `health`,
 * ...) out of the nested family/parent/camper objects.
 */
export function parseCallablePayload<T>(
  validator: Validator<T>,
  data: unknown
): T {
  try {
    return validator(data);
  } catch (error) {
    if (isSchemaValidationError(error)) {
      throw new HttpsError("invalid-argument", error.message, {
        issues: error.issues,
      });
    }
    throw error;
  }
}
