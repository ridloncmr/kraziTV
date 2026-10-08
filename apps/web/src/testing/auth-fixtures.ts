import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { AuthState } from "../http/contracts.js";
import { App } from "../app.js";
import { BrowserApi } from "./browser-api.js";

/** The one account the web tests log on as; its name differs from every label. */
export const account = { displayName: "Marguerite", avatarId: "duck" };

/** `GET /auth/state` for a browser without a session. */
export const loggedOut: AuthState = {
  setupRequired: false,
  account,
  authenticated: false,
};

/** `GET /auth/state`, or a login's or setup's answer, for a logged-in browser. */
export const loggedIn: AuthState = { ...loggedOut, authenticated: true };

/** `GET /auth/state` before the account exists. */
export const setupRequired: AuthState = {
  setupRequired: true,
  account: null,
  authenticated: false,
};

/**
 * Stubs `fetch` with a browser API whose `/auth/state` answers `state`, with a
 * healthy desktop behind it, so app-root tests start from one auth answer.
 */
export function stubAuthApi(state: unknown, status = 200): BrowserApi {
  const api = new BrowserApi();
  api.reply("/auth/state", state, "GET", status);
  api.reply("/health", { status: "ok" });
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

/**
 * Boots the app root on `state` and waits for the desktop, so a test starts
 * from the logged-in desktop the app root holds the account for.
 */
export async function bootDesktop(state: AuthState = loggedIn) {
  const api = stubAuthApi(state);
  render(createElement(App));
  await screen.findByRole("button", { name: "start" });
  return api;
}

/**
 * The server's `429 too_many_attempts` error body, carrying the wait only
 * when given, so throttle tests can also cover an answer that omits it.
 */
export function tooManyAttempts(retryAfterSeconds?: number) {
  return {
    error: {
      code: "too_many_attempts",
      message: "Too many wrong passwords; wait before trying again",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}
