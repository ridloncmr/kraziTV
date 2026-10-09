import { createElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { MediaItem, ReviewStep } from "../http/contracts.js";
import { MediaLibraryApp } from "../media-library/media-library-app.js";
import { BrowserApi } from "./browser-api.js";

/**
 * Renders Media Library over a catalog of `items`, no media roots, and
 * `steps` waiting for review, and returns the API so a test can add routes.
 */
export async function showMediaLibrary(
  items: MediaItem[],
  steps: ReviewStep[] = [],
) {
  const api = new BrowserApi();
  api.reply("/media-roots", []);
  api.reply("/media-items", { items, total: items.length });
  api.reply("/metadata/match-reviews", { steps });
  vi.stubGlobal("fetch", api.fetch);
  render(createElement(MediaLibraryApp, { visible: true }));
  await screen.findByText(items[0].title);
  return api;
}

/** Opens an item's details through its list action, without selecting its row. */
export function openMediaDetails(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Details for ${title}` }));
  return screen.getByRole("dialog", { name: "Media details" });
}

/** Opens an item's details, then its correction form. */
export function openCorrection(title: string) {
  fireEvent.click(
    within(openMediaDetails(title)).getByRole("button", {
      name: "Correct details…",
    }),
  );
  return within(screen.getByRole("dialog", { name: "Correct details" }));
}

/** Replaces a labeled field's text in the correction form. */
export function typeCorrection(
  form: ReturnType<typeof openCorrection>,
  label: string,
  value: string,
) {
  fireEvent.change(form.getByLabelText(label), { target: { value } });
}
