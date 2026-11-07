/**
 * Explains why a new password's confirmation fails, or returns undefined.
 * Setup and Account Settings share it so they never disagree; a password is
 * never trimmed. Only the confirmation is checked here: the length limits
 * are the server's, and its refusal carries the numbers the owner reads, so
 * the web never keeps a copy of them.
 */
export function newPasswordRefusal(
  password: string,
  confirm: string,
): string | undefined {
  return password === confirm
    ? undefined
    : "The passwords you typed do not match.";
}
