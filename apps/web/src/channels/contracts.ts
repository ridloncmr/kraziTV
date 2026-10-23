import type { StretchSuggestion } from "../http/contracts/programming.js";

/** What a show plays, as the stretch suggestion classifies it; null for mixed or unclassified. */
export type ContentKind = StretchSuggestion["contentKind"];
