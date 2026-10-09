// Test-only stand-in for TMDB over HTTP; production code must never import this module.
import type { TestBarrier } from "./test-barrier.js";

/**
 * Answers the real TmdbClient's requests the way TMDB would, so route tests
 * exercise the client's own status mapping instead of a looser fake. It
 * accepts only `validKeys`, records the Bearer token each call carried, and
 * fails every call as a network error while `unreachable` is set. It
 * normally answers at once and ignores the abort signal; an optional barrier
 * models delayed validation, but cannot model cancellation or a timeout.
 */
export class ScriptedTmdbFetch {
  readonly validKeys = new Set<string>();
  unreachable = false;
  /** The token each request carried, in call order. */
  readonly tokens: string[] = [];
  /** Pauses only the next call, so tests can interleave a replacement or removal. */
  nextCallBarrier?: TestBarrier;

  /** The fetch to hand TmdbClient; bound so it can be passed bare. */
  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = new Headers(init?.headers)
      .get("authorization")
      ?.replace(/^Bearer /, "");
    this.tokens.push(token ?? "");
    const barrier = this.nextCallBarrier;
    this.nextCallBarrier = undefined;
    if (barrier) await barrier.wait();
    if (this.unreachable) throw new TypeError("fetch failed");
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).pathname !== "/3/authentication") {
      return Response.json({ status_code: 34 }, { status: 404 });
    }
    return token !== undefined && this.validKeys.has(token)
      ? Response.json({ success: true, status_code: 1 })
      : Response.json({ success: false, status_code: 7 }, { status: 401 });
  };
}
