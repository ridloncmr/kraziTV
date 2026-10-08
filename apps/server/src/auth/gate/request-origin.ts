// Methods that never change state. OPTIONS is a CORS preflight, which
// @fastify/cors answers before the gate and browsers send without cookies.
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Decides whether a request is a cross-site write to refuse. Browsers always
 * send `Origin` on a non-GET request, so a write whose `Origin` is present
 * and is not an allowed origin came from another site, even with a valid
 * cookie. A request without one is not a browser, which never carries the
 * cookie anyway. `allowedOrigins` must already be normalized; the request's
 * value is compared as an origin, and anything unparseable (`null`, a list,
 * garbage) is foreign.
 */
export function isForeignOrigin(
  method: string,
  originHeader: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (SAFE_METHODS.has(method) || originHeader === undefined) return false;
  if (!URL.canParse(originHeader)) return true;
  return !allowedOrigins.has(new URL(originHeader).origin);
}
