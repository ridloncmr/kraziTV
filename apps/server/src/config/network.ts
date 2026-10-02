import { parseIntegerSetting } from "./integer-setting.js";

interface ListenConfig {
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
    // The 1 minimum rejects 0, so the server never binds a random port.
    port: parseIntegerSetting("PORT", env.PORT, DEFAULT_PORT, MAX_PORT),
  };
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
