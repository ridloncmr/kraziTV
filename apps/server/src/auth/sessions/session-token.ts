import { createHash, randomBytes } from "node:crypto";

/** How long a session lives after it is created or last extended. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

/** Creates an unguessable session token, base64url so it fits a cookie value unescaped. */
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Hashes a token for storage and lookup, so a leaked database cannot be
 * replayed as cookies. SHA-256 without a salt suffices because the token is
 * 32 random bytes, not a guessable secret, and lookup needs a stable hash.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
