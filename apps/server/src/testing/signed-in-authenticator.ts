// Test-only auth gate stand-in; production code must never import this module.
import type {
  Authentication,
  RequestAuthenticator,
} from "../auth/contracts.js";

/**
 * Signs every request in, so suites about catalog, channels, or schedules
 * exercise their routes without cookies. It implements the gate's own
 * contract, so a change to what the gate asks breaks it at compile time.
 * Auth suites use the real service instead.
 */
export class SignedInAuthenticator implements RequestAuthenticator {
  /** Answers authenticated whatever the request carries. */
  async authenticate(): Promise<Authentication> {
    return { kind: "authenticated" };
  }
}
