import { assertPositiveSafeInteger } from "@krazitv/process";

// The one origin the client calls (ADR 0013); never built from user input.
const TMDB_API_BASE = "https://api.themoviedb.org/3";

// Visible ASCII only: anything else cannot travel in an HTTP header, and
// fetch's error for such a header quotes the whole value, token included.
const HEADER_SAFE_TOKEN = /^[!-~]+$/;

/**
 * Names why fetch threw by its network error code alone. fetch's own message
 * can quote request headers, so it never becomes a reason.
 */
function fetchFailureReason(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  return typeof code === "string"
    ? `TMDB request failed (${code})`
    : "TMDB request failed";
}

/**
 * What TMDB said about a token. An outage is a result, not a throw, so a
 * caller never mistakes it for a rejected key. `reason` never holds the token.
 */
export type TmdbKeyCheck =
  | { kind: "valid" }
  | { kind: "rejected" }
  | { kind: "unreachable"; reason: string };

/** What a TMDB request produced: an answer, or why there was none. */
type TmdbAnswer =
  | { kind: "answered"; response: Response }
  | { kind: "unreachable"; reason: string };

interface TmdbClientOptions {
  /** Replaces Node's fetch in tests; production omits it. */
  fetch?: typeof fetch;
  /** Positive per-request deadline, so a hung TMDB never stalls a caller. */
  timeoutMs: number;
}

/**
 * Calls TMDB with the user's API Read Access Token (ADR 0013). It stores
 * nothing; the server owns the token and passes it to each call, so a saved
 * replacement is used at once.
 */
export class TmdbClient {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  // Rejects an unusable timeout at composition, not on the first lookup.
  constructor(options: TmdbClientOptions) {
    assertPositiveSafeInteger(options.timeoutMs, "timeoutMs");
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs;
  }

  /**
   * Asks TMDB whether `apiKey` is a usable token. A `401`, or a token that
   * cannot be sent at all, means rejected; any other failure is an outage, so
   * a good key is never refused because TMDB was down. The caller's abort is
   * rethrown, not reported.
   */
  async checkKey(apiKey: string, signal?: AbortSignal): Promise<TmdbKeyCheck> {
    if (!HEADER_SAFE_TOKEN.test(apiKey)) return { kind: "rejected" };
    const answer = await this.#request("/authentication", apiKey, signal);
    if (answer.kind === "unreachable") return answer;
    // Only the status matters; releasing the body frees the connection now.
    await answer.response.body?.cancel();
    const { status } = answer.response;
    if (status === 401) return { kind: "rejected" };
    if (answer.response.ok) return { kind: "valid" };
    return { kind: "unreachable", reason: `TMDB answered HTTP ${status}` };
  }

  /**
   * Sends one GET with the token as a Bearer header, bounded by the timeout.
   * Failure reasons come from the status, the timeout, or a network error
   * code, never from fetch's message, so the token cannot leak into them.
   */
  async #request(
    path: string,
    apiKey: string,
    signal: AbortSignal | undefined,
  ): Promise<TmdbAnswer> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await this.#fetch(`${TMDB_API_BASE}${path}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
      return { kind: "answered", response };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted) {
        return {
          kind: "unreachable",
          reason: `TMDB did not answer within ${this.#timeoutMs} ms`,
        };
      }
      return { kind: "unreachable", reason: fetchFailureReason(error) };
    }
  }
}
