/**
 * Explains why this display name cannot be sent, or returns undefined.
 * Setup and Account Settings share it so they never disagree; the caller
 * trims first, because the server counts the trimmed name. Only a blank name
 * is caught here: the length limit is the server's, and its refusal carries
 * the number the owner reads, so the web never keeps a copy of it.
 */
export function displayNameRefusal(trimmedName: string): string | undefined {
  return trimmedName === "" ? "Type your name." : undefined;
}
