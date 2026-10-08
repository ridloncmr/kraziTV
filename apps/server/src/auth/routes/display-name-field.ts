import { nameField } from "../../http/request-schemas.js";

/**
 * The account's display name: trimmed, 1 to 40 characters. Setup and the
 * account change share this one rule, so the two can never disagree.
 */
export const displayNameField = nameField.max(
  40,
  "displayName must be at most 40 characters",
);
