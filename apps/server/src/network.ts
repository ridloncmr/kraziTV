export function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();

  return (
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost.startsWith("127.")
  );
}

export function parseCorsOrigins(
  value: string | undefined,
): string[] | undefined {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : undefined;
}
