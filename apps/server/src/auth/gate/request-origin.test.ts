import { describe, expect, it } from "vitest";

import { isForeignOrigin } from "./request-origin.js";

const allowed = new Set(["http://127.0.0.1:5173", "https://tv.lan"]);

describe("isForeignOrigin", () => {
  it.each(["GET", "HEAD", "OPTIONS"])(
    "never refuses %s, which cannot change anything",
    (method) => {
      expect(isForeignOrigin(method, "http://evil.example", allowed)).toBe(
        false,
      );
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "lets %s through without an Origin, which only a non-browser omits",
    (method) => {
      expect(isForeignOrigin(method, undefined, allowed)).toBe(false);
    },
  );

  it.each([
    "http://127.0.0.1:5173",
    "https://tv.lan",
    // Compared as origins, never as raw strings.
    "HTTPS://TV.LAN",
    "https://tv.lan:443",
    "https://tv.lan/",
  ])("lets a write from the allowed origin %s through", (origin) => {
    expect(isForeignOrigin("POST", origin, allowed)).toBe(false);
  });

  it.each([
    "http://evil.example",
    "http://127.0.0.1:5174",
    "http://tv.lan",
    "null",
    "",
    "not a url",
    "file:///etc/passwd",
    "http://127.0.0.1:5173, http://evil.example",
  ])("refuses a write from %j", (origin) => {
    expect(isForeignOrigin("DELETE", origin, allowed)).toBe(true);
  });
});
