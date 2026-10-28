import { describe, expect, it } from "vitest";

import type { NetworkInterfaceInfo } from "node:os";

import {
  isLoopbackHost,
  networkBaseUrl,
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

describe("parseCorsOrigins", () => {
  it("parses a comma-separated allowlist", () => {
    expect(
      parseCorsOrigins("http://127.0.0.1:5173, https://admin.example "),
    ).toEqual(["http://127.0.0.1:5173", "https://admin.example"]);
  });

  it("uses the server default when no origins are configured", () => {
    expect(parseCorsOrigins("  ")).toBeUndefined();
  });

  it("normalizes each origin, so case and a trailing slash never matter", () => {
    expect(
      parseCorsOrigins("HTTP://Admin.Example:8080/, https://tv.lan:443"),
    ).toEqual(["http://admin.example:8080", "https://tv.lan"]);
  });

  it.each([
    "*",
    "null",
    "http://admin.example/app",
    "http://admin.example/?x=1",
    "http://admin.example/#top",
    "http://user:pw@admin.example",
    "ftp://admin.example",
    "admin.example",
    "http://127.0.0.1:5173, *",
  ])("rejects CORS_ORIGINS=%s", (value) => {
    expect(() => parseCorsOrigins(value)).toThrow(
      /CORS_ORIGINS entries must be absolute http: or https: origins/,
    );
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

describe("isLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "localhost",
    "LOCALHOST",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
  ])("treats %s as this computer only", (host) =>
    expect(isLoopbackHost(host)).toBe(true),
  );

  it.each([
    "0.0.0.0",
    "::",
    "192.168.1.10",
    "::ffff:192.168.1.10",
    "tv.example",
    "127.example",
  ])("treats %s as reachable from the network", (host) =>
    expect(isLoopbackHost(host)).toBe(false),
  );
});

describe("networkBaseUrl", () => {
  /** One interface address as os.networkInterfaces reports it. */
  const address = (
    value: string,
    family: "IPv4" | "IPv6" = "IPv4",
    internal = false,
  ) => ({ address: value, family, internal }) as NetworkInterfaceInfo;

  it("prefers a home network's address over a container bridge's", () => {
    expect(
      networkBaseUrl(3000, {
        lo: [address("127.0.0.1", "IPv4", true)],
        docker0: [address("172.17.0.1")],
        eth0: [address("fe80::1", "IPv6"), address("192.168.1.10")],
      }),
    ).toBe("http://192.168.1.10:3000");
  });

  it("falls back to any other network address, skipping link-local ones", () => {
    expect(
      networkBaseUrl(8080, {
        eth0: [address("169.254.3.4"), address("10.0.0.5")],
      }),
    ).toBe("http://10.0.0.5:8080");
  });

  it("returns null with no network address", () => {
    expect(
      networkBaseUrl(3000, { lo: [address("127.0.0.1", "IPv4", true)] }),
    ).toBeNull();
  });
});
