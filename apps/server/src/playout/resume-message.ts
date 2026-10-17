/**
 * Words when guide-visible programming resumes after planned filler: the
 * resume time in the programming timezone and 12-hour form, such as
 * "8:00 PM" (programming spec 0006). The one place that formats it, so the
 * on-screen message and the Program Guide always agree. Intl's narrow
 * no-break spaces become plain ones, which every font draws.
 */
export function resumeTime(resumesAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(resumesAt)
    .replace(/[\u00a0\u202f]/g, " ");
}

/** Words filler's on-screen message, such as "Programming resumes at 8:00 PM". */
export function resumeMessage(resumesAt: number, timeZone: string): string {
  return `Programming resumes at ${resumeTime(resumesAt, timeZone)}`;
}
