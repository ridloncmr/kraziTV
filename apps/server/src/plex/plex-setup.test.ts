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
  });
});
