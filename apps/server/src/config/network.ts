/** Decides whether the bind address stays on this machine, which gates the no-auth warning. */
export function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();

  return (
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost.startsWith("127.")
  );
}

/** Returns undefined for an empty setting so the server keeps its local Web UI default. */
export function parseCorsOrigins(
  value: string | undefined,
): string[] | undefined {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : undefined;
}
