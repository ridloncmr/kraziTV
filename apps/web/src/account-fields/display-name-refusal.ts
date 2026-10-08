// Mirrors the server's display-name rule (spec 0001) so a mistake is caught
// before sending; the server still decides, and its refusal is shown as it comes.
const MAX_NAME_LENGTH = 40;

/**
 * Explains why the server would refuse this display name, or returns
 * undefined. Setup and Account Settings share it so they never disagree; the
 * caller trims first, because the server counts the trimmed name.
 */
export function displayNameRefusal(trimmedName: string): string | undefined {
  if (trimmedName === "") return "Type your name.";
  if (trimmedName.length > MAX_NAME_LENGTH)
    return `Your name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  return undefined;
}
