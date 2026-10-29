import { expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import { refusalWords } from "./refusal-words.js";

// An invalid_request refusal as the server sends it: the fields in details.
const invalid = (...paths: string[]) =>
  new ApiError("invalid_request", "for logs", 400, {
    fields: paths.map((path) => ({ path, code: "custom" })),
  });

it("says what a channel number looks like when the number is refused", () => {
  expect(refusalWords(invalid("number"))).toBe(
    "A channel number is a whole number such as 12, or one with a subchannel such as 12.1.",
  );
});

it("words a field by its own name wherever it sits in the body", () => {
  expect(refusalWords(invalid("assignments[1].name"))).toBe("Type a name.");
});

it("joins the sentences of several refused fields, each once", () => {
  expect(refusalWords(invalid("startsAt", "endsAt", "endsAt"))).toBe(
    "Type a start date and time. The end must come after the start.",
  );
});

it("has no words for a field it does not know, so the server's message shows", () => {
  expect(refusalWords(invalid("ordinaryStretch"))).toBeUndefined();
  expect(
    refusalWords(new ApiError("invalid_request", "for logs", 400)),
  ).toBeUndefined();
});

it("words a special refusal from its code and details", () => {
  expect(
    refusalWords(new ApiError("reservation_in_past", "for logs", 409)),
  ).toBe("A special must start in the future. Pick a later start.");
});

it("has no words for an unknown code or an error that is not a refusal", () => {
  expect(
    refusalWords(new ApiError("something_else", "for logs", 409)),
  ).toBeUndefined();
  // A code several routes share is worded only where the context is known.
  expect(
    refusalWords(new ApiError("media_item_not_found", "for logs", 404)),
  ).toBeUndefined();
  expect(refusalWords(new Error("Failed to fetch"))).toBeUndefined();
  expect(refusalWords(undefined)).toBeUndefined();
});
