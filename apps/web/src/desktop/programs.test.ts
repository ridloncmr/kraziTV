import { expect, it } from "vitest";
import type { WindowId } from "./contracts.js";
import { programOf, propertiesWindow } from "./programs.js";
import { UnknownWindowError } from "./unknown-window-error.js";

it("finds a launcher program and a properties window's definition", () => {
  expect(programOf("guide").name).toBe("Program Guide");
  expect(programOf(propertiesWindow("channel-properties", "c1")).name).toBe(
    "Channel Properties",
  );
});

it("names a window ID no program defines instead of returning nothing", () => {
  expect(() => programOf("unheard-of" as WindowId)).toThrow(UnknownWindowError);
  expect(() => programOf("unheard-of:x" as WindowId)).toThrow(
    'No program defines window "unheard-of:x"',
  );
});
