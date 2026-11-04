import { ApiError } from "./api-error.js";

const environment = import.meta.env as {
  VITE_API_BASE_URL?: string;
  DEV?: boolean;
};
const baseUrl = (
  environment.VITE_API_BASE_URL ??
  (environment.DEV ? "http://127.0.0.1:3000" : "")
).replace(/\/$/, "");

/** The tray's words when kraziTV does not answer; the TV and request failures build on them. */
export const CANT_REACH_WORDS = "Can't reach kraziTV";

/**
 * What a request failure says when it never reached the server: the tray's
 * words and what to do, since nothing else on screen says to wait or reload
 * (release-polish spec 0004).
 */
export const UNREACHABLE_SENTENCE = `${CANT_REACH_WORDS}. Check that it is running, then press Refresh.`;

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

/**
 * The absolute URL of an API path, for what the browser loads without
 * `apiRequest`, such as the TV program's broadcast stream.
 */
export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
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
 * A request that never reached the server, whether refused, timed out, or
 * answered by a gateway without an envelope, fails with the owner's
 * unreachable sentence, never the browser's words (release-polish spec 0004).
 */
export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(path === "/health" ? 5_000 : 45_000);
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
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
  } catch (failure) {
    // The caller's own abort is its decision, kept as thrown; anything else
    // (a refused connection, the timeout) means the server never answered.
    if (options.signal?.aborted) throw failure;
    throw new ApiError("unreachable", UNREACHABLE_SENTENCE, 0);
  }
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
    throw new ApiError("request_failed", UNREACHABLE_SENTENCE, response.status);
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
