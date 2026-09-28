import { describe, expect, it } from "vitest";

import { isLoopbackHost, parseCorsOrigins } from "./network.js";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.0.0.2", "localhost", "::1"])(
    "recognizes %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "192.168.1.20", "server.lan"])(
    "recognizes %s as network-exposed",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("parseCorsOrigins", () => {
  it("parses a comma-separated allowlist", () => {
    expect(
      parseCorsOrigins("http://127.0.0.1:5173, https://admin.example "),
    ).toEqual(["http://127.0.0.1:5173", "https://admin.example"]);
  });

  it("uses the server default when no origins are configured", () => {
    expect(parseCorsOrigins("  ")).toBeUndefined();
  });
});
