// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { openFromShortcut } from "../testing/auth-fixtures.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KEY_PATH = "/metadata/tmdb-key";

/** Opens Account Settings' **Set up TMDB** task with the server reporting `configured`. */
async function openTmdbTask(configured: boolean) {
  const { api, window } = await openFromShortcut();
  api.reply(KEY_PATH, { configured });
  fireEvent.click(within(window).getByRole("button", { name: "Set up TMDB" }));
  await within(window).findByText(
    configured ? "A TMDB key is set." : "No TMDB key is set.",
  );
  return { api, window };
}

/** Types `key` into the token box and presses Save. */
function saveKey(window: HTMLElement, key: string) {
  fireEvent.change(within(window).getByLabelText("API Read Access Token"), {
    target: { value: key },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Save" }));
}

/** Waits for the task to finish and Account Settings to show its task links again. */
async function expectHome(window: HTMLElement) {
  expect(
    await within(window).findByRole("button", { name: "Set up TMDB" }),
  ).toBeTruthy();
  expect(within(window).queryByLabelText("API Read Access Token")).toBeNull();
}

it("shows no key set, TMDB's logo and notice, and no Remove", async () => {
  const { window } = await openTmdbTask(false);

  expect(within(window).getByRole("img", { name: "TMDB" })).toBeTruthy();
  expect(
    within(window).getByText(
      "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
    ),
  ).toBeTruthy();
  expect(within(window).queryByRole("button", { name: "Remove" })).toBeNull();
});

it("says the token is free and links to where TMDB keeps it, in a new tab", async () => {
  const { window } = await openTmdbTask(false);

  expect(
    within(window).getByText(
      (_, element) =>
        element?.tagName === "P" &&
        element.textContent ===
          "The token is free: it is the API Read Access Token under Settings, API on themoviedb.org.",
    ),
  ).toBeTruthy();
  const link = within(window).getByRole("link", {
    name: "Settings, API on themoviedb.org",
  });
  expect(link.getAttribute("href")).toBe(
    "https://www.themoviedb.org/settings/api",
  );
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener");
});

it("links the TMDB logo to TMDB in a new tab", async () => {
  const { window } = await openTmdbTask(false);

  const link = within(window).getByRole("link", { name: "TMDB" });
  expect(link.getAttribute("href")).toBe("https://www.themoviedb.org/");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener");
  expect(within(link).getByRole("img", { name: "TMDB" })).toBeTruthy();
});

it("shows a saved key as set, never its value, and offers Remove", async () => {
  const { window } = await openTmdbTask(true);

  expect(
    within(window).getByLabelText<HTMLInputElement>("API Read Access Token")
      .value,
  ).toBe("");
  expect(within(window).getByRole("button", { name: "Remove" })).toBeTruthy();
});

it("sends the trimmed key, then returns home", async () => {
  const { api, window } = await openTmdbTask(false);
  api.reply(KEY_PATH, { configured: true }, "PUT");

  saveKey(window, "  eyJ.token.sig  ");

  await expectHome(window);
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method === "PUT"),
  ).toMatchObject([{ body: { apiKey: "eyJ.token.sig" } }]);
});

it("refuses a blank key without sending it", async () => {
  const { api, window } = await openTmdbTask(false);

  saveKey(window, "   ");

  expect(within(window).getByRole("alert").textContent).toBe(
    "Paste your TMDB API Read Access Token.",
  );
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method !== "GET"),
  ).toEqual([]);
});

it("shows the server's invalid_tmdb_key message and stays on the task", async () => {
  const { api, window } = await openTmdbTask(false);
  api.reply(
    KEY_PATH,
    {
      error: {
        code: "invalid_tmdb_key",
        message: "TMDB did not accept this key.",
      },
    },
    "PUT",
    400,
  );

  saveKey(window, "eyJ.revoked.sig");

  expect((await within(window).findByRole("alert")).textContent).toBe(
    "TMDB did not accept this key.",
  );
  expect(within(window).getByLabelText("API Read Access Token")).toBeTruthy();
});

/** Presses the task's **Remove** and returns the question it opens. */
function pressRemove(window: HTMLElement) {
  fireEvent.click(within(window).getByRole("button", { name: "Remove" }));
  return within(window).getByRole("dialog", { name: "Remove TMDB key" });
}

it("asks before removing the key, then removes it and returns home", async () => {
  const { api, window } = await openTmdbTask(true);
  api.reply(KEY_PATH, { configured: false }, "DELETE");

  const question = pressRemove(window);

  expect(question.querySelector("p")?.textContent).toBe(
    "Remove the TMDB key? Matches already made stay; new lookups stop until a key is set.",
  );
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method !== "GET"),
  ).toEqual([]);

  fireEvent.click(within(question).getByRole("button", { name: "Remove" }));

  await expectHome(window);
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method !== "GET"),
  ).toMatchObject([{ method: "DELETE" }]);
});

it("keeps the key when the question is cancelled", async () => {
  const { api, window } = await openTmdbTask(true);

  const question = pressRemove(window);
  fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));

  expect(within(window).queryByRole("dialog")).toBeNull();
  expect(within(window).getByText("A TMDB key is set.")).toBeTruthy();
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method !== "GET"),
  ).toEqual([]);
});

it("shows a refused removal in the question, which stays open", async () => {
  const { api, window } = await openTmdbTask(true);
  api.reply(
    KEY_PATH,
    {
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    },
    "DELETE",
    500,
  );

  const question = pressRemove(window);
  fireEvent.click(within(question).getByRole("button", { name: "Remove" }));

  expect((await within(question).findByRole("alert")).textContent).toBe(
    "kraziTV hit a problem it could not recover from. Try again; if it keeps happening, check the kraziTV log.",
  );
  expect(within(window).getByRole("dialog", { name: "Remove TMDB key" })).toBe(
    question,
  );
});

it("reopens the question clean after a refused removal is cancelled", async () => {
  const { api, window } = await openTmdbTask(true);
  api.reply(
    KEY_PATH,
    {
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    },
    "DELETE",
    500,
  );
  const refused = pressRemove(window);
  fireEvent.click(within(refused).getByRole("button", { name: "Remove" }));
  await within(refused).findByRole("alert");
  fireEvent.click(within(refused).getByRole("button", { name: "Cancel" }));

  const reopened = pressRemove(window);

  expect(within(reopened).queryByRole("alert")).toBeNull();
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method === "DELETE"),
  ).toHaveLength(1);
});

it("sends nothing on Cancel and returns home", async () => {
  const { api, window } = await openTmdbTask(true);

  fireEvent.change(within(window).getByLabelText("API Read Access Token"), {
    target: { value: "eyJ.token.sig" },
  });
  fireEvent.click(within(window).getByRole("button", { name: "Cancel" }));

  await expectHome(window);
  expect(
    api.requestsTo(KEY_PATH).filter((request) => request.method !== "GET"),
  ).toEqual([]);
});
