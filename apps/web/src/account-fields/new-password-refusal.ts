// Mirror the server's new-password rule (spec 0001) so a mistake is caught
// before sending; the server still decides, and its refusal is shown as it comes.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

/**
 * Explains why the server would refuse this new password, or why its
 * confirmation fails, or returns undefined. Setup and Account Settings share
 * it so they never disagree; a password is never trimmed.
 */
export function newPasswordRefusal(
  password: string,
  confirm: string,
): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Your password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  if (password !== confirm) return "The passwords you typed do not match.";
  return undefined;
}
