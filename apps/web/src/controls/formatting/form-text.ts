/** Text-only admin forms reject file values rather than silently stringifying them. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
