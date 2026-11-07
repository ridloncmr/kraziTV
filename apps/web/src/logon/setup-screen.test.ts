// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loggedIn } from "../testing/auth-fixtures.js";
import { BrowserApi } from "../testing/browser-api.js";
import { SetupScreen } from "./setup-screen.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the setup screen over `api` and returns its callbacks. */
function renderSetup(api: BrowserApi) {
  vi.stubGlobal("fetch", api.fetch);
  const onSetUp = vi.fn();
  const onAlreadySetUp = vi.fn();
  render(createElement(SetupScreen, { onSetUp, onAlreadySetUp }));
  return { onSetUp, onAlreadySetUp };
}

/** Fills the three fields and submits the form the way Enter does. */
function submitSetup(name: string, password: string, confirm = password) {
  const field = (label: string) => screen.getByLabelText(label);
  fireEvent.change(field("Your name"), { target: { value: name } });
  fireEvent.change(field("Password"), { target: { value: password } });
  fireEvent.change(field("Confirm password"), { target: { value: confirm } });
  fireEvent.submit(
    screen.getByRole("button", { name: "Next" }).closest("form")!,
  );
}

it("shows one welcome panel with the three fields, the name focused", () => {
  renderSetup(new BrowserApi());
  expect(
    screen.getByRole("heading", { name: "Welcome to kraziTV" }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Your name"));
  expect(screen.getByLabelText("Password")).toBeTruthy();
  expect(screen.getByLabelText("Confirm password")).toBeTruthy();
});

it.each([
  {
    refusal: "a blank name",
    fields: ["   ", "correct horse"],
    says: "Type your name.",
  },
  {
    refusal: "mismatched passwords",
    fields: ["Marguerite", "correct horse", "correct horsf"],
    says: "The passwords you typed do not match.",
  },
])("refuses $refusal before sending and says why", ({ fields, says }) => {
  const api = new BrowserApi();
  renderSetup(api);
  const [name, password, confirm] = fields as [string, string, string?];
  submitSetup(name, password, confirm);
  expect(screen.getByRole("alert").textContent).toBe(says);
  expect(api.requestsTo("/auth/setup")).toHaveLength(0);
});

it("accepts a 40-character name once trimmed and an 8-character password", async () => {
  const api = new BrowserApi();
  api.reply("/auth/setup", loggedIn, "POST", 201);
  const { onSetUp } = renderSetup(api);
  const name = "n".repeat(40);
  submitSetup(`  ${name}  `, "eight888");
  await waitFor(() => expect(onSetUp).toHaveBeenCalledWith(loggedIn));
  expect(api.requestsTo("/auth/setup")[0]?.body).toEqual({
    displayName: name,
    password: "eight888",
  });
});

it("disables the form while setup runs", async () => {
  const api = new BrowserApi();
  api.hold("/auth/setup", "POST");
  renderSetup(api);
  submitSetup("Marguerite", "correct horse");
  const next = screen.getByRole("button", { name: "Next" });
  await waitFor(() => expect(next.matches(":disabled")).toBe(true));
  // The fieldset disables every field; :disabled is what the browser applies.
  expect(screen.getByLabelText("Your name").matches(":disabled")).toBe(true);
});

it("words the server's invalid_request by the field it names", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/setup",
    {
      error: {
        code: "invalid_request",
        message: "displayName: displayName must be at most 40 characters",
        fields: [{ path: "displayName", code: "too_big", maximum: 40 }],
      },
    },
    "POST",
    400,
  );
  const { onSetUp, onAlreadySetUp } = renderSetup(api);
  submitSetup("Marguerite", "correct horse");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Use a shorter name: at most 40 characters.",
  );
  expect(onSetUp).not.toHaveBeenCalled();
  expect(onAlreadySetUp).not.toHaveBeenCalled();
});

it("leaves a password's length to the server and words its refusal from the limit it sent", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/setup",
    {
      error: {
        code: "invalid_request",
        message: "password: password must be at least 8 characters",
        fields: [{ path: "password", code: "too_small", minimum: 8 }],
      },
    },
    "POST",
    400,
  );
  renderSetup(api);
  submitSetup("Marguerite", "seven77");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Use a password of at least 8 characters.",
  );
  expect(api.requestsTo("/auth/setup")[0]?.body).toEqual({
    displayName: "Marguerite",
    password: "seven77",
  });
});

it("reports a 409 already_set_up instead of showing it", async () => {
  const api = new BrowserApi();
  api.reply(
    "/auth/setup",
    {
      error: {
        code: "already_set_up",
        message: "The account is already set up",
      },
    },
    "POST",
    409,
  );
  const { onSetUp, onAlreadySetUp } = renderSetup(api);
  submitSetup("Marguerite", "correct horse");
  await waitFor(() => expect(onAlreadySetUp).toHaveBeenCalledTimes(1));
  expect(onSetUp).not.toHaveBeenCalled();
});
