import { ApiError } from "./api-error.js";

const environment = import.meta.env as {
  VITE_API_BASE_URL?: string;
  DEV?: boolean;
};
const baseUrl = (
  environment.VITE_API_BASE_URL ??
  (environment.DEV ? "http://127.0.0.1:3000" : "")
).replace(/\/$/, "");

// The one place a `401` is reported; the app root owns it (spec 0002).
let unauthorizedListener: (() => void) | undefined;

/**
 * Registers the one listener told about every `401` answer, replacing any
 * earlier one. The returned function unregisters it, unless a newer
 * listener has taken the slot since.
 */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListener = listener;
  return () => {
    if (unauthorizedListener === listener) unauthorizedListener = undefined;
  };
}

/** Public paths use encoded IDs so user-controlled identity never changes routing. */
export function resourcePath(area: string, id: string): string {
  return `/${area}/${encodeURIComponent(id)}`;
}

/**
 * All requests share JSON errors, bounded waits, and caller-owned cancellation.
 * Every request carries the session cookie, which the server gate requires;
 * the dev web app and API share a host name, so `SameSite=Strict` allows it.
 * A `401` is reported to the unauthorized listener and still thrown, unless
 * the caller aborted the request: an abandoned request speaks for no one.
 */
export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(path === "/health" ? 5_000 : 45_000);
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    signal,
    ...(options.body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }),
  });
  if (!response.ok) {
    if (response.status === 401 && !options.signal?.aborted)
      unauthorizedListener?.();
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      /* A proxy may answer with HTML. */
    }
    if (
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "object" &&
      value.error !== null
    ) {
      const error = value.error as Record<string, unknown>;
      throw new ApiError(
        typeof error.code === "string" ? error.code : "request_failed",
        typeof error.message === "string" ? error.message : response.statusText,
        response.status,
        error,
      );
    }
    throw new ApiError(
      "request_failed",
      `API request failed (${response.status} ${response.statusText})`,
      response.status,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
