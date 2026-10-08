import { z } from "zod";

/**
 * Any password the server will check. Never trimmed: every character the
 * owner typed is part of the password. The cap bounds the scrypt work one
 * attempt can ask for. No minimum, so a short guess simply fails to match.
 */
export const passwordField = z
  .string()
  .max(256, "password must be at most 256 characters");

/**
 * A password the owner chooses, at setup or reset: 8 to 256 characters with
 * no other composition rules (spec 0001). Setup and the reset command share
 * this one definition.
 */
export const newPasswordField = passwordField.min(
  8,
  "password must be at least 8 characters",
);
