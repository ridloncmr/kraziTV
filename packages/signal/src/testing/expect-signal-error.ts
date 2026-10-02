import { expect } from "vitest";

import { SignalError, type SignalErrorCode } from "../errors.js";

/** Asserts that a promise rejects with a typed signal error, then returns it for detail checks. */
export async function expectSignalError(
  promise: Promise<unknown>,
  code: SignalErrorCode,
): Promise<SignalError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SignalError);
    expect(error).toMatchObject({ code });
    return error as SignalError;
  }
  throw new Error(`Expected ${code}`);
}
