/**
 * Formats epoch milliseconds as an XMLTV timestamp, `YYYYMMDDHHmmss +0000`.
 * Always UTC with an explicit offset so the host time zone never shifts the
 * guide; XMLTV has no millisecond field, so milliseconds are truncated.
 */
export function formatXmltvTime(epochMs: number): string {
  const digits = new Date(epochMs).toISOString().replace(/\D/g, "");
  return `${digits.slice(0, 14)} +0000`;
}
