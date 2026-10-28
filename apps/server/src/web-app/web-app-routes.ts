import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

// The web workspace's build, found from this module so it is the same folder
// whether the server runs from src/ under tsx or from dist/.
const BUILT_WEB_APP = fileURLToPath(
  new URL("../../../web/dist", import.meta.url),
);

/**
 * Returns the built web app's folder when `npm run build` has produced one,
 * or undefined so the server runs API-only, as it does beside `vite dev`.
 */
export function findBuiltWebApp(directory = BUILT_WEB_APP): string | undefined {
  return existsSync(path.join(directory, "index.html")) ? directory : undefined;
}

/**
 * Serves the built web app from the API's own origin, so an installed
 * kraziTV needs no second server and no CORS. The build is `index.html`
 * plus content-hashed files under `assets/`, so exactly two public routes
 * serve it and the auth gate's list stays fixed: a catch-all would answer
 * 404 for unknown paths and let a logged-out client tell them from admin
 * routes. `index.html` is read on each request and never cached, so a
 * rebuild takes effect on the next load; hashed assets are cached for good.
 */
export function registerWebAppRoutes(
  server: FastifyInstance,
  directory: string,
): void {
  const indexFile = path.join(directory, "index.html");
  server.get("/", async (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      // No other site may frame the admin page or reinterpret its content.
      .header("content-security-policy", "frame-ancestors 'none'")
      .header("x-content-type-options", "nosniff")
      .send(await readFile(indexFile)),
  );
  void server.register(fastifyStatic, {
    root: path.join(directory, "assets"),
    prefix: "/assets/",
    index: false,
    dotfiles: "ignore",
    maxAge: "365d",
    immutable: true,
  });
}
