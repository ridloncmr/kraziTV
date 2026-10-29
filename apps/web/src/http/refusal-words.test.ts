import { expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import { refusalWords, refusedFields } from "./refusal-words.js";

// An invalid_request refusal as the server sends it: the fields in details.
const invalid = (...fields: [path: string, code: string][]) =>
  new ApiError("invalid_request", "for logs", 400, {
    fields: fields.map(([path, code]) => ({ path, code })),
  });

it("says what a channel number looks like when the number is refused", () => {
  expect(refusalWords(invalid(["number", "custom"]))).toBe(
    "A channel number is a whole number such as 12, or one with a subchannel such as 12.1.",
  );
});

it("words a field by its own name wherever it sits in the body", () => {
  expect(refusalWords(invalid(["assignments[1].name", "too_small"]))).toBe(
    "Type a name.",
  );
});

it("words a field by the check it failed, so no sentence is wrong", () => {
  // A long name is not a missing one.
  expect(refusalWords(invalid(["name", "too_big"]))).toBe(
    "Use a shorter name.",
  );
  // A login refuses only the cap; the setup minimum belongs to setup.
  expect(refusalWords(invalid(["password", "too_big"]))).toBe(
    "Use a password of at most 256 characters.",
  );
  expect(refusalWords(invalid(["password", "too_small"]))).toBe(
    "Use a password of at least 8 characters.",
  );
  // A collection special with no end and an end before the start share one sentence.
  expect(refusalWords(invalid(["endsAt", "custom"]))).toBe(
    "Pick an end after the start.",
  );
  expect(refusalWords(invalid(["endsAt", "invalid_format"]))).toBe(
    "Type an end date and time.",
  );
});

it("joins the sentences of several refused fields, each once", () => {
  expect(
    refusalWords(
      invalid(
        ["startsAt", "invalid_union"],
        ["endsAt", "custom"],
        ["endsAt", "custom"],
      ),
    ),
  ).toBe("Type a start date and time. Pick an end after the start.");
});

it("has no words for a field or check it does not know, so the server's message shows", () => {
  expect(refusalWords(invalid(["ordinaryStretch", "custom"]))).toBeUndefined();
  expect(refusalWords(invalid(["number", "invalid_type"]))).toBeUndefined();
  expect(
    refusalWords(new ApiError("invalid_request", "for logs", 400)),
  ).toBeUndefined();
});

it("reads each refused field's path and code, skipping malformed entries", () => {
  const error = new ApiError("invalid_request", "for logs", 400, {
    fields: [
      { path: "assignments[2].name", code: "too_big" },
      { path: 3 },
      "x",
    ],
  });

  expect(refusedFields(error)).toEqual([
    { path: "assignments[2].name", code: "too_big" },
  ]);
  expect(refusedFields(new Error("Failed to fetch"))).toEqual([]);
  expect(refusedFields(undefined)).toEqual([]);
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
