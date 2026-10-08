/**
 * Every route a request may reach without a session (ADR 0012), as
 * `METHOD pattern` with Fastify's matched route pattern. Anything not listed
 * is gated, so a new route is private until someone adds it here.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  // Startup and liveness checks.
  "GET /health",
  // A logged-out browser needs these to set up, log in, and log out.
  "GET /auth/state",
  "POST /auth/setup",
  "POST /auth/login",
  "POST /auth/logout",
  // Plex's HDHomeRun tuner cannot authenticate (ADR 0002).
  "GET /discover.json",
  "GET /lineup.json",
  "GET /lineup_status.json",
  "GET /device.xml",
  // Plex's guide.
  "GET /plex/xmltv.xml",
  // Plex tunes channels here.
  "GET /channels/:id/stream",
  // @fastify/cors's preflight route. Browsers never send cookies on a
  // preflight, and the plugin answers it in its own hook with headers only.
  "OPTIONS *",
]);

/**
 * Decides whether a matched route is public. `routeUrl` is the route pattern
 * Fastify matched, undefined when none did, so extra slashes, case changes,
 * or encodings can only miss the list, never land on a public entry. HEAD is
 * Fastify's automatic twin of a GET route and answers the same.
 */
export function isPublicRoute(
  method: string,
  routeUrl: string | undefined,
): boolean {
  if (routeUrl === undefined) return false;
  const listedMethod = method === "HEAD" ? "GET" : method;
  return PUBLIC_ROUTES.has(`${listedMethod} ${routeUrl}`);
}
