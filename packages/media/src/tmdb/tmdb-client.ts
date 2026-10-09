import { assertPositiveSafeInteger } from "@krazitv/process";

import {
  readMovieDetails,
  readMovieSearch,
  type TmdbMovie,
  type TmdbMovieSummary,
} from "./tmdb-movie.js";
import { TmdbRequestQueue } from "./tmdb-request-queue.js";

// The one origin the client calls (ADR 0013); never built from user input.
const TMDB_API_BASE = "https://api.themoviedb.org/3";

// Visible ASCII only: anything else cannot travel in an HTTP header, and
// fetch's error for such a header quotes the whole value, token included.
const HEADER_SAFE_TOKEN = /^[!-~]+$/;

// 30 per second stays under TMDB's soft ceiling of about 40 with room for it
// to move; 5 in flight keeps one slow answer from idling the line.
const QUEUE_LIMITS = { maxInFlight: 5, perSecond: 30 };

// A 429 is retried this many times before the lookup reports it.
const MAX_RETRIES = 3;

// The wait before retrying a 429 that names no usable Retry-After.
const DEFAULT_RETRY_MS = 1_000;

// A longer Retry-After is reported rather than waited out, so one lookup
// never holds a scan in `enriching` for minutes.
const MAX_RETRY_MS = 10_000;

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

/**
 * A lookup's value, or why TMDB gave none. A failure is a result, not a
 * throw, so one item's lookup error never fails a scan. `reason` never holds
 * the token.
 */
type TmdbLookup<T> =
  { kind: "ok"; value: T } | { kind: "failed"; reason: string };

/** What a movie search sends: path-hint terms only, never a file path (ADR 0013). */
export interface TmdbMovieQuery {
  title: string;
  year?: number;
}

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
 * replacement is used at once. Every call waits in this client's one request
 * queue, so the process builds one client and shares it.
 */
export class TmdbClient {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #queue = new TmdbRequestQueue(QUEUE_LIMITS);

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
   * rethrown, not reported. The owner is waiting on the answer, so the check
   * goes ahead of queued lookups and a `429` is not retried.
   */
  async checkKey(apiKey: string, signal?: AbortSignal): Promise<TmdbKeyCheck> {
    if (!HEADER_SAFE_TOKEN.test(apiKey)) return { kind: "rejected" };
    const answer = await this.#request(
      "/authentication",
      apiKey,
      signal,
      async (answer) => {
        if (answer.kind === "answered") await discardBody(answer.response);
        return answer;
      },
      true,
    );
    if (answer.kind === "unreachable") return answer;
    // Only the status matters; releasing the body frees the connection now.
    const { status } = answer.response;
    if (status === 401) return { kind: "rejected" };
    if (answer.response.ok) return { kind: "valid" };
    return { kind: "unreachable", reason: `TMDB answered HTTP ${status}` };
  }

  /**
   * Searches TMDB's movies by title and, when hinted, year. TMDB's `year`
   * filter also matches later releases, so callers compare each result's own
   * first-release year.
   */
  async searchMovies(
    apiKey: string,
    query: TmdbMovieQuery,
    signal?: AbortSignal,
  ): Promise<TmdbLookup<TmdbMovieSummary[]>> {
    const params = new URLSearchParams({
      query: query.title,
      include_adult: "false",
    });
    if (query.year !== undefined) params.set("year", String(query.year));
    return this.#lookUp(
      `/search/movie?${params.toString()}`,
      apiKey,
      readMovieSearch,
      signal,
    );
  }

  /** Reads one movie's first-release facts by its TMDB ID. */
  async movieDetails(
    apiKey: string,
    id: number,
    signal?: AbortSignal,
  ): Promise<TmdbLookup<TmdbMovie>> {
    return this.#lookUp(`/movie/${id}`, apiKey, readMovieDetails, signal);
  }

  /**
   * Sends a lookup GET and reads its JSON body. A `429` waits for TMDB's
   * `Retry-After`, up to ten seconds, and rejoins the queue, up to three
   * retries; any other failure, or a body `read` cannot use, is reported
   * rather than thrown.
   */
  async #lookUp<T>(
    path: string,
    apiKey: string,
    read: (body: unknown) => T | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TmdbLookup<T>> {
    if (!HEADER_SAFE_TOKEN.test(apiKey)) {
      return { kind: "failed", reason: "TMDB rejected the key" };
    }
    for (let retries = 0; ; retries += 1) {
      const answer = await this.#request(
        path,
        apiKey,
        signal,
        async (answer) => {
          if (answer.kind === "unreachable") return answer;
          const value = answer.response.ok
            ? read(await readJson(answer.response))
            : undefined;
          if (!answer.response.ok) await discardBody(answer.response);
          return { ...answer, value };
        },
      );
      if (answer.kind === "unreachable") {
        return { kind: "failed", reason: answer.reason };
      }
      const { response } = answer;
      if (response.ok) {
        const { value } = answer;
        return value === undefined
          ? {
              kind: "failed",
              reason: "TMDB sent a response kraziTV could not read",
            }
          : { kind: "ok", value };
      }
      const delayMs = retryDelayMs(response);
      if (
        response.status !== 429 ||
        retries === MAX_RETRIES ||
        delayMs > MAX_RETRY_MS
      ) {
        return {
          kind: "failed",
          reason: `TMDB answered HTTP ${response.status}`,
        };
      }
      await waitFor(delayMs, signal);
    }
  }

  // Owns the slot through body consumption; a cancelled waiter never sends.
  async #request<T>(
    path: string,
    apiKey: string,
    signal: AbortSignal | undefined,
    consume: (answer: TmdbAnswer) => Promise<T>,
    urgent = false,
  ): Promise<T> {
    return this.#queue.run(
      async () => {
        const result = await consume(await this.#send(path, apiKey, signal));
        // Aborted body reads must preserve the caller's cancellation contract.
        if (signal?.aborted) throw signal.reason;
        return result;
      },
      {
        signal,
        urgent,
      },
    );
  }

  /**
   * Sends one GET with the token as a Bearer header, bounded by the timeout,
   * which starts only once the queue lets the request go. Failure reasons
   * come from the status, the timeout, or a network error code, never from
   * fetch's message, so the token cannot leak into them.
   */
  async #send(
    path: string,
    apiKey: string,
    signal: AbortSignal | undefined,
  ): Promise<TmdbAnswer> {
    // A cancel can land between the slot opening and this call.
    if (signal?.aborted) throw signal.reason;
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

// TMDB's Retry-After is whole seconds; a missing or odd value waits the default.
function retryDelayMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : DEFAULT_RETRY_MS;
}

// Resolves after `delayMs`, or rejects with the caller's abort reason.
function waitFor(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Frees the connection; a body that already failed has nothing left to free,
// so its error never turns one answer's status into a thrown scan failure.
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status already says what the answer was.
  }
}

// A body that is not JSON reads as undefined, which every reader rejects.
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}
