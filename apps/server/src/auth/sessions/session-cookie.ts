const SESSION_COOKIE_NAME = "krazitv_session";

/**
 * Formats the one `Set-Cookie` value kraziTV sends. `HttpOnly` keeps the token
 * out of page scripts and `SameSite=Strict` keeps other sites from sending it;
 * `Secure` follows the public base URL, because a plain-http LAN install would
 * otherwise never get its cookie back.
 */
export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/**
 * Reads the session token from a request's `Cookie` header, or undefined when
 * it carries none. Only kraziTV's own base64url tokens are expected, so the
 * value is taken as-is rather than percent-decoded. The first occurrence wins,
 * as browsers send the most specific cookie first.
 */
export function readSessionCookie(
  header: string | undefined,
): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}
