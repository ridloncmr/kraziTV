import { specialWords } from "../channels/specials/special-words.js";
import { ApiError } from "./api-error.js";

// The owner's sentence for each field the server can refuse, saying what a
// good value looks like (release-polish spec 0002). A field not listed falls
// back to the server's message, so nothing is silently lost.
const FIELD_WORDS: Record<string, string> = {
  number:
    "A channel number is a whole number such as 12, or one with a subchannel such as 12.1.",
  name: "Type a name.",
  displayName: "Type a name of 1 to 40 characters.",
  password: "Type a password of 8 to 256 characters.",
  path: "Type the full path of a folder on the server, starting from its root.",
  startsAt: "Type a start date and time.",
  endsAt: "The end must come after the start.",
};

/**
 * The fields an `invalid_request` refusal names in its details, by the
 * field's own name: `assignments[1].ordinaryStretch` is `ordinaryStretch`,
 * since the sentence for a field is the same wherever the field sits.
 */
function refusedFieldNames(details: Record<string, unknown>): string[] {
  const fields = Array.isArray(details.fields) ? details.fields : [];
  return fields.flatMap((field: unknown) => {
    const path =
      typeof field === "object" && field !== null && "path" in field
        ? field.path
        : undefined;
    if (typeof path !== "string") return [];
    const name = path
      .replace(/\[\d+\]/g, "")
      .split(".")
      .at(-1);
    return name ? [name] : [];
  });
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
    refusedFieldNames(error.details).flatMap((name) => {
      const sentence = FIELD_WORDS[name];
      return sentence === undefined ? [] : [sentence];
    }),
  );
  return sentences.size === 0 ? undefined : [...sentences].join(" ");
}
