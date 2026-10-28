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

// The names a browser on the server's own computer may use for it.
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];

/** True when `origin` names this computer, so only browsers on it can use it. */
export function isLoopbackOrigin(origin: string): boolean {
  return (
    URL.canParse(origin) &&
    LOOPBACK_HOSTNAMES.includes(new URL(origin).hostname)
  );
}

/**
 * Returns the public base URL's origin with every loopback spelling of it,
 * same scheme and port, so an owner on the server's computer can use
 * kraziTV at `localhost` when the public base URL says `127.0.0.1`. Only
 * the public base URL gets these: it is kraziTV's own address, while a CORS
 * entry such as `127.0.0.1:5173` may share its port number with another
 * app's dev server under a different spelling.
 */
export function withLoopbackAliases(publicOrigin: string): Set<string> {
  const allowed = new Set([publicOrigin]);
  if (!isLoopbackOrigin(publicOrigin)) return allowed;
  const url = new URL(publicOrigin);
  for (const hostname of LOOPBACK_HOSTNAMES) {
    url.hostname = hostname;
    allowed.add(url.origin);
  }
  return allowed;
}
