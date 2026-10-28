// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserApi } from "../testing/browser-api.js";
import { PlexSetupApp } from "./plex-setup-app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens Plex Setup against a server reporting `setup`. */
function openPlexSetup(setup: object) {
  const api = new BrowserApi();
  api.reply("/plex/setup", {
    tunerBaseUrl: "http://127.0.0.1:3000",
    xmltvUrl: "http://127.0.0.1:3000/plex/xmltv.xml",
    suggestedPublicBaseUrl: "http://192.168.1.10:3000",
    ...setup,
  });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(PlexSetupApp, { visible: true }));
}

it("warns that only Plex on this computer can connect, with each fix ready to copy", async () => {
  openPlexSetup({ localOnlySettings: ["PUBLIC_BASE_URL", "HOST"] });

  const warning = await screen.findByRole("alert");
  expect(warning.textContent).toContain(
    "Only Plex on this computer can reach kraziTV.",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Address setting").value).toBe(
    "PUBLIC_BASE_URL=http://192.168.1.10:3000",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Listen setting").value).toBe(
    "HOST=0.0.0.0",
  );
});

it("asks for this computer's address when it has none to suggest", async () => {
  openPlexSetup({
    localOnlySettings: ["PUBLIC_BASE_URL"],
    suggestedPublicBaseUrl: null,
  });

  const warning = await screen.findByRole("alert");
  expect(warning.textContent).toMatch(
    /PUBLIC_BASE_URL=http:\/\/<this computer's network\s+address>:3000/,
  );
  expect(screen.queryByLabelText("Listen setting")).toBeNull();
});

it("shows no warning when Plex elsewhere can connect", async () => {
  openPlexSetup({
    tunerBaseUrl: "http://192.168.1.10:3000",
    xmltvUrl: "http://192.168.1.10:3000/plex/xmltv.xml",
    localOnlySettings: [],
  });

  await screen.findByLabelText("Tuner base URL");
  expect(screen.queryByRole("alert")).toBeNull();
});
