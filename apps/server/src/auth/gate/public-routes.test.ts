import { describe, expect, it } from "vitest";

import { isPublicRoute, PUBLIC_ROUTES } from "./public-routes.js";

describe("isPublicRoute", () => {
  it("lists exactly the spec 0001 public routes plus the CORS preflight", () => {
    expect([...PUBLIC_ROUTES].sort()).toEqual(
      [
        "GET /health",
        "GET /auth/state",
        "POST /auth/setup",
        "POST /auth/login",
        "POST /auth/logout",
        "GET /discover.json",
        "GET /lineup.json",
        "GET /lineup_status.json",
        "GET /device.xml",
        "GET /plex/xmltv.xml",
        "GET /channels/:id/stream",
        "OPTIONS *",
      ].sort(),
    );
  });

  it("lets every listed route through", () => {
    for (const entry of PUBLIC_ROUTES) {
      const [method, url] = entry.split(" ");
      expect(isPublicRoute(method, url)).toBe(true);
    }
  });

  it.each(["/health", "/channels/:id/stream", "/plex/xmltv.xml"])(
    "treats HEAD on the public GET route %s as public",
    (url) => {
      expect(isPublicRoute("HEAD", url)).toBe(true);
    },
  );

  it.each([
    ["GET", "/plex/setup"],
    ["GET", "/channels"],
    ["GET", "/channels/:id"],
    ["POST", "/channels/:id/stream"],
    ["POST", "/health"],
    ["GET", "/auth/setup"],
    ["HEAD", "/channels"],
    ["DELETE", "/auth/logout"],
    // A route pattern, never a raw path, decides; a concrete path is not one.
    ["GET", "/channels/abc/stream"],
    ["GET", "/Health"],
    ["get", "/health"],
  ])("gates %s %s", (method, url) => {
    expect(isPublicRoute(method, url)).toBe(false);
  });

  it("gates a request that matched no route", () => {
    expect(isPublicRoute("GET", undefined)).toBe(false);
  });
});
