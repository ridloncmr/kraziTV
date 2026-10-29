import { specialWords } from "../channels/specials/special-words.js";
import { ApiError } from "./api-error.js";

// The owner's sentence for each field the server can refuse, by the Zod
// issue code that refused it, saying what a good value looks like
// (release-polish spec 0002). Keying by code keeps every sentence true: a
// login refuses only a password's length cap, never its setup minimum. A
// field or code not listed falls back to the server's message, so nothing
// is silently lost.
const FIELD_WORDS: Record<string, Partial<Record<string, string>>> = {
  number: {
    custom:
      "A channel number is a whole number such as 12, or one with a subchannel such as 12.1.",
  },
  name: {
    too_small: "Type a name.",
    too_big: "Use a shorter name.",
  },
  displayName: {
    too_small: "Type a name of 1 to 40 characters.",
    too_big: "Type a name of 1 to 40 characters.",
  },
  password: {
    too_small: "Use a password of at least 8 characters.",
    too_big: "Use a password of at most 256 characters.",
  },
  newPassword: {
    too_small: "Use a new password of at least 8 characters.",
    too_big: "Use a new password of at most 256 characters.",
  },
  path: {
    custom:
      "Type the full path of a folder on the server, starting from its root.",
  },
  startsAt: {
    invalid_union: "Type a start date and time.",
    invalid_format: "Type a start date and time.",
  },
  // Both end checks are custom: an end before the start, and a collection
  // special with no end. One sentence is true of both.
  endsAt: {
    custom: "Pick an end after the start.",
    invalid_format: "Type an end date and time.",
  },
};

/** One field a refusal names: its dotted path in the body and its Zod issue code. */
type RefusedField = { path: string; code: string };

/**
 * The fields an `invalid_request` refusal names in `details.fields`, in the
 * server's order. The one parser of that shape, so every caller reads it
 * the same way; anything else has none.
 */
export function refusedFields(error: Error | undefined): RefusedField[] {
  if (!(error instanceof ApiError)) return [];
  const fields: unknown[] = Array.isArray(error.details.fields)
    ? error.details.fields
    : [];
  return fields.flatMap((field) => {
    if (typeof field !== "object" || field === null) return [];
    const { path, code } = field as { path?: unknown; code?: unknown };
    return typeof path === "string" && typeof code === "string"
      ? [{ path, code }]
      : [];
  });
}

/**
 * The owner's sentence for one refused field, by the field's own name:
 * `assignments[1].name` is `name`, since the sentence for a field is the
 * same wherever the field sits.
 */
function fieldSentence({ path, code }: RefusedField): string | undefined {
  const name = path
    .replace(/\[\d+\]/g, "")
    .split(".")
    .at(-1);
  return name === undefined ? undefined : FIELD_WORDS[name]?.[code];
}

/**
 * Whether a code belongs to specials alone. A code several routes share,
 * such as `media_item_not_found`, is worded only where the special preview
 * knows the context.
 */
function isSpecialCode(code: string): boolean {
  return code.startsWith("reservation_") || code === "airing_filler_conflict";
}

/**
 * Words a refusal for the owner: what to change for each refused field the
 * web app knows, or a special refusal's sentence. Returns nothing for a
 * code or field it does not know, and for an error that is not a refusal,
 * so the caller shows the server's message instead (release-polish spec
 * 0002, decision 1).
 */
export function refusalWords(error: Error | undefined): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (isSpecialCode(error.code)) {
    return specialWords(error.code, error.details);
  }
  if (error.code !== "invalid_request") return undefined;
  const sentences = new Set(
    refusedFields(error).flatMap((field) => fieldSentence(field) ?? []),
  );
  return sentences.size === 0 ? undefined : [...sentences].join(" ");
}
