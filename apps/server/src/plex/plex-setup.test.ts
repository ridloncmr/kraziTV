import { afterEach, expect, it } from "vitest";

import {
  cleanUpTestEnvironment,
  startTestServer,
} from "../testing/test-environment.js";

afterEach(cleanUpTestEnvironment);

it("supplies setup URLs from public configuration rather than request Host", async () => {
  const { server } = await startTestServer({
    plex: { publicBaseUrl: "https://tv.example:8443" },
  });
  const response = await server.inject({
    url: "/plex/setup",
    headers: { host: "spoof.invalid" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    tunerBaseUrl: "https://tv.example:8443",
    xmltvUrl: "https://tv.example:8443/plex/xmltv.xml",
    localOnlySettings: [],
    suggestedPublicBaseUrl: "http://192.0.2.10:3000",
  });
});

it("names each setting that keeps Plex on another device out", async () => {
  const { server } = await startTestServer({
    plex: { publicBaseUrl: "http://127.0.0.1:3000", listenHost: "127.0.0.1" },
  });
  const response = await server.inject({ url: "/plex/setup" });
  expect(response.json()).toMatchObject({
    localOnlySettings: ["PUBLIC_BASE_URL", "HOST"],
  });
});
