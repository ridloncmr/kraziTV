import { expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import { refusalWords, refusedFields } from "./refusal-words.js";

// An invalid_request refusal as the server sends it: the fields in details,
// each with any limit or problem kind the server adds beside its code.
const invalid = (
  ...fields: [path: string, code: string, extra?: Record<string, unknown>][]
) =>
  new ApiError("invalid_request", "for logs", 400, {
    fields: fields.map(([path, code, extra]) => ({ path, code, ...extra })),
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

it("words a too-long name from the limit the server sent, never its own copy", () => {
  // A channel or collection name is capped at 120, a show's or rule's at 80.
  expect(refusalWords(invalid(["name", "too_big", { maximum: 120 }]))).toBe(
    "Use a shorter name: at most 120 characters.",
  );
  expect(
    refusalWords(invalid(["assignments[0].name", "too_big", { maximum: 80 }])),
  ).toBe("Use a shorter name: at most 80 characters.");
  // The account's name says its own limit the same way.
  expect(
    refusalWords(invalid(["displayName", "too_big", { maximum: 40 }])),
  ).toBe("Use a shorter name: at most 40 characters.");
  // A refusal without a limit still says what to change, with no number.
  expect(refusalWords(invalid(["name", "too_big"]))).toBe(
    "Use a shorter name.",
  );
});

it("words a password's length from the limit the server sent", () => {
  // A login refuses only the cap; the setup minimum belongs to setup.
  expect(refusalWords(invalid(["password", "too_big", { maximum: 256 }]))).toBe(
    "Use a password of at most 256 characters.",
  );
  expect(
    refusalWords(invalid(["password", "too_small", { minimum: 12 }])),
  ).toBe("Use a password of at least 12 characters.");
  expect(
    refusalWords(invalid(["newPassword", "too_small", { minimum: 8 }])),
  ).toBe("Use a new password of at least 8 characters.");
  expect(refusalWords(invalid(["newPassword", "too_big"]))).toBe(
    "Use a shorter new password.",
  );
  expect(refusalWords(invalid(["password", "too_small"]))).toBe(
    "Use a longer password.",
  );
});

it("words a field by the check it failed, so no sentence is wrong", () => {
  // A missing name is not a long one.
  expect(refusalWords(invalid(["name", "too_small", { minimum: 1 }]))).toBe(
    "Type a name.",
  );
  expect(refusalWords(invalid(["displayName", "too_small"]))).toBe(
    "Type a name.",
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

it("reads the limit and problem kind a refused field carries, dropping ill-typed ones", () => {
  const error = new ApiError("invalid_request", "for logs", 400, {
    fields: [
      { path: "name", code: "too_big", maximum: 80 },
      { path: "password", code: "too_small", minimum: 8 },
      { path: "", code: "custom", problemKind: "unit" },
      { path: "name", code: "too_big", maximum: "80", problemKind: 3 },
    ],
  });

  expect(refusedFields(error)).toEqual([
    { path: "name", code: "too_big", maximum: 80 },
    { path: "password", code: "too_small", minimum: 8 },
    { path: "", code: "custom", problemKind: "unit" },
    { path: "name", code: "too_big" },
  ]);
});

it("words a special refusal from its code and details", () => {
  expect(
    refusalWords(new ApiError("reservation_in_past", "for logs", 409)),
  ).toBe("A special must start in the future. Pick a later start.");
});

it("words the refusals one code explains in the screens' words, never the server's", () => {
  expect(
    refusalWords(
      new ApiError("media_collection_in_use", "for logs", 409, {
        mediaCollectionId: "favorites",
        channelIds: ["one"],
        reservations: [],
      }),
    ),
  ).toBe(
    "This collection is in a channel's lineup or a special. Remove it there first.",
  );
  expect(
    refusalWords(
      new ApiError("programming_member_assigned", "for logs", 409, {
        member: { kind: "collection", mediaCollectionId: "favorites" },
        assignmentId: "assignment-1",
      }),
    ),
  ).toBe("Another show on this channel already plays that.");
});

it("words a rule's stretch refusals by the problem's kind, naming the rule by name", () => {
  // The problem text is kraziBrain's to reword, so the words never depend on it.
  const problem = "reworded by kraziBrain";
  expect(
    refusalWords(
      new ApiError("programming_rule_stretch_invalid", "for logs", 400, {
        assignmentId: "christmas-turns",
        problem,
        problemKind: "shorter",
      }),
    ),
  ).toBe("Make the marathon longer than Plays at a time.");
  expect(
    refusalWords(
      new ApiError("programming_rule_stretch_conflict", "for logs", 409, {
        ruleId: "rule-1",
        ruleName: "Christmas",
        problem,
        problemKind: "shorter",
      }),
    ),
  ).toBe(
    'Rule "Christmas" follows this show\'s settings, and this change would break them. Change the rule first: make the marathon longer than Plays at a time.',
  );
  // A conflict without the rule's name still says what to change.
  expect(
    refusalWords(
      new ApiError("programming_rule_stretch_conflict", "for logs", 409, {
        ruleId: "rule-1",
        problem,
        problemKind: "unit",
      }),
    ),
  ).toBe(
    "A rule on this channel follows this show's settings, and this change would break them. Change the rule first: set the marathon in the same unit as Plays at a time: programs with programs, minutes with minutes.",
  );
});

it("says kraziTV is busy saving another change, whatever the write", () => {
  // The server's message is for logs; the words come from the code.
  expect(
    refusalWords(
      new ApiError("schedule_busy", "for logs", 503, { retryable: true }),
    ),
  ).toBe("kraziTV is busy saving another change. Try again in a moment.");
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
