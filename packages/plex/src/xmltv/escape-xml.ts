const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Escapes text for XML element content or a double- or single-quoted
 * attribute, so names and titles from users never change document structure.
 */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? "");
}
