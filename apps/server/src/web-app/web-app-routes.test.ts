import { afterEach, describe, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  createTemporaryDirectory,
  startTestServer,
} from "../testing/test-environment.js";
import {
  WEB_APP_INDEX,
  WEB_APP_SCRIPT,
  writeWebAppFixture,
} from "../testing/web-app-fixture.js";
import { findBuiltWebApp } from "./web-app-routes.js";

afterEach(cleanUpTestEnvironment);

/** A gated server serving the fixture build, with no account set up. */
async function startWebAppServer() {
  const { server } = await startTestServer({
    auth: "real",
    webAppDirectory: await writeWebAppFixture(),
  });
  return server;
}

describe("web app routes", () => {
  it("serves the page before anyone logs in, never cached", async () => {
    const server = await startWebAppServer();

    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["content-security-policy"]).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.body).toBe(WEB_APP_INDEX);
  });

  it("serves hashed assets before anyone logs in, cached for good", async () => {
    const server = await startWebAppServer();

    const response = await server.inject({
      method: "GET",
      url: "/assets/index-abc123.js",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.body).toBe(WEB_APP_SCRIPT);
  });

  it("never serves dotfiles or paths outside assets", async () => {
    const server = await startWebAppServer();

    const dotfile = await server.inject({ url: "/assets/.secret" });
    // Encoded, so the URL parser keeps the escape and the plugin sees it.
    const escape = await server.inject({ url: "/assets/..%2findex.html" });
    const rootFile = await server.inject({ url: "/index.html" });

    expect(dotfile.statusCode).toBe(404);
    expect(escape.statusCode).toBeGreaterThanOrEqual(400);
    expect(escape.body).not.toBe(WEB_APP_INDEX);
    // Outside assets/ only `/` serves the page; anything else is gated.
    expect(rootFile.statusCode).toBe(401);
  });

  it("keeps API routes gated beside the web app", async () => {
    const server = await startWebAppServer();

    const response = await server.inject({ url: "/channels" });

    expect(response.statusCode).toBe(401);
  });
});

describe("findBuiltWebApp", () => {
  it("finds a folder holding a build", async () => {
    const directory = await writeWebAppFixture();

    expect(findBuiltWebApp(directory)).toBe(directory);
  });

  it("finds nothing before the web app is built", async () => {
    expect(findBuiltWebApp(await createTemporaryDirectory())).toBeUndefined();
  });
});
