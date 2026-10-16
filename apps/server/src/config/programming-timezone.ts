import type { FastifyBaseLogger } from "fastify";

// Names hosts report when no local timezone is set, as containers often do.
const UTC_NAMES = new Set(["UTC", "Etc/UTC", "Etc/GMT", "GMT"]);

/**
 * Resolves the one server-wide programming timezone calendar rules are
 * evaluated in (programming spec 0005), once at startup:
 * `KRAZITV_PROGRAMMING_TIMEZONE` when set, or else the host's timezone.
 * Logs which it chose and why, and warns when an unset setting falls back
 * to a UTC host, since rules would then ignore the owner's local time. An
 * invalid name fails startup rather than evaluating rules somewhere else.
 */
export function resolveProgrammingTimezone(
  env: Readonly<Record<string, string | undefined>>,
  log: Pick<FastifyBaseLogger, "info" | "warn">,
  hostTimeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const configured = env.KRAZITV_PROGRAMMING_TIMEZONE?.trim();
  if (configured) {
    const programmingTimezone = canonicalTimeZone(configured);
    if (programmingTimezone === undefined) {
      throw new Error(
        `KRAZITV_PROGRAMMING_TIMEZONE must be an IANA timezone name such as America/New_York; received "${env.KRAZITV_PROGRAMMING_TIMEZONE}"`,
      );
    }
    log.info(
      { programmingTimezone, source: "configured" },
      "Using the configured programming timezone",
    );
    return programmingTimezone;
  }
  const fields = { programmingTimezone: hostTimeZone, source: "host" };
  if (UTC_NAMES.has(hostTimeZone)) {
    log.warn(
      fields,
      "KRAZITV_PROGRAMMING_TIMEZONE is unset and the host reports UTC; set it so calendar rules follow local time",
    );
  } else {
    log.info(
      fields,
      "KRAZITV_PROGRAMMING_TIMEZONE is unset; using the host timezone",
    );
  }
  return hostTimeZone;
}

/**
 * Returns the IANA name `Intl` resolves a timezone to, so a case-only
 * difference names the same zone, or undefined when it knows no such zone.
 */
function canonicalTimeZone(name: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: name,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
