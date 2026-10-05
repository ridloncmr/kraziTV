import { describe, expect, it } from "vitest";

import {
  isLoopbackHost,
  parseCorsOrigins,
  parseListenConfig,
  parsePublicBaseUrl,
} from "./network.js";

describe("parseListenConfig", () => {
  it("binds loopback on port 3000 by default", () => {
    expect(parseListenConfig({})).toEqual({ host: "127.0.0.1", port: 3000 });
  });

  it("treats blank settings as unset", () => {
    expect(parseListenConfig({ HOST: "  ", PORT: " " })).toEqual({
      host: "127.0.0.1",
      port: 3000,
    });
  });

  it("uses configured values", () => {
    expect(parseListenConfig({ HOST: " 0.0.0.0 ", PORT: "8080" })).toEqual({
      host: "0.0.0.0",
      port: 8080,
    });
  });

  it.each(["abc", "0", "65536", "80.5", "1e3", "-1"])(
    "rejects PORT=%s",
    (value) => {
      expect(() => parseListenConfig({ PORT: value })).toThrow(
        `PORT must be an integer from 1 through 65535; received "${value}"`,
      );
    },
  );
});

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

describe("parsePublicBaseUrl", () => {
  it("follows PORT on loopback when unset", () => {
    expect(parsePublicBaseUrl(undefined, 3000)).toBe("http://127.0.0.1:3000");
    expect(parsePublicBaseUrl("  ", 8080)).toBe("http://127.0.0.1:8080");
  });

  it("trims a trailing slash", () => {
    expect(parsePublicBaseUrl(" https://tv.example.lan:8443/ ", 3000)).toBe(
      "https://tv.example.lan:8443",
    );
  });

  it.each([
    "http://tv.lan/krazitv",
    "http://tv.lan/?debug=1",
    "http://tv.lan/#guide",
    "ftp://tv.lan",
    "http://user:secret@tv.lan",
    "tv.lan:3000",
  ])("rejects PUBLIC_BASE_URL=%s", (value) => {
    expect(() => parsePublicBaseUrl(value, 3000)).toThrow(
      `PUBLIC_BASE_URL must be an absolute http: or https: URL with no credentials, path, query, or fragment; received "${value}"`,
    );
  });
});
