export interface ListenConfig {
  host: string;
  port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

/**
 * Resolves the bind address once at startup so a typo such as PORT=abc fails
 * with the setting's name instead of a NaN error from inside Fastify.
 */
export function parseListenConfig(
  env: Readonly<Record<string, string | undefined>>,
): ListenConfig {
  return {
    host: env.HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.PORT),
  };
}

// Accepts only plain decimal digits, and rejects 0 so the server never binds a random port.
function parsePort(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_PORT;
  }

  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
    throw new Error(
      `PORT must be an integer from 1 through ${MAX_PORT}; received "${value}"`,
    );
  }
  return parsed;
}

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
