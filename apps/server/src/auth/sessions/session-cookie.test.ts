import { describe, expect, it } from "vitest";

import { readSessionCookie, sessionCookie } from "./session-cookie.js";

describe("session cookie", () => {
  it("carries the token with fixed attributes and no Secure flag over http", () => {
    expect(sessionCookie("abc_-1", 2_592_000, false)).toBe(
      "krazitv_session=abc_-1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict",
    );
  });

  it("adds Secure when the public base URL is https", () => {
    expect(sessionCookie("abc", 60, true)).toBe(
      "krazitv_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Strict; Secure",
    );
  });

  it.each([
    ["the only cookie", "krazitv_session=tok", "tok"],
    ["one of several", "a=1; krazitv_session=tok; b=2", "tok"],
    ["padded with spaces", "a=1 ;  krazitv_session = tok ", "tok"],
    ["first of duplicates", "krazitv_session=one; krazitv_session=two", "one"],
  ])("reads the token when it is %s", (_, header, token) => {
    expect(readSessionCookie(header)).toBe(token);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["only other cookies", "other=1; krazitv_session_old=2"],
    ["an empty value", "krazitv_session="],
    ["a name without a value", "krazitv_session"],
  ])("reads no token from %s", (_, header) => {
    expect(readSessionCookie(header)).toBeUndefined();
  });
});
