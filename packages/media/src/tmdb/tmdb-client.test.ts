import { describe, expect, it } from "vitest";

import { TmdbClient } from "./tmdb-client.js";
import { answering, hanging } from "../testing/tmdb-fetch.js";

const TOKEN = "eyJ.read-access-token.sig";

describe("TmdbClient.checkKey", () => {
  it("validates the token as a Bearer header against TMDB's authentication route", async () => {
    const { fetch, calls } = answering(200);
    const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({ kind: "valid" });
    expect(calls).toEqual([
      {
        url: "https://api.themoviedb.org/3/authentication",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  it("reports a 401 as a rejected key, not an outage", async () => {
    const client = new TmdbClient({
      fetch: answering(401).fetch,
      timeoutMs: 1_000,
    });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "rejected",
    });
  });

  it.each([429, 500, 503])(
    "reports a %i as unreachable, naming the status",
    async (status) => {
      const client = new TmdbClient({
        fetch: answering(status).fetch,
        timeoutMs: 1_000,
      });

      await expect(client.checkKey(TOKEN)).resolves.toEqual({
        kind: "unreachable",
        reason: `TMDB answered HTTP ${status}`,
      });
    },
  );

  it("reports a network failure by its code, never fetch's message, which can quote the token", async () => {
    const client = new TmdbClient({
      fetch: () =>
        Promise.reject(
          new TypeError(`Bearer ${TOKEN} failed`, {
            cause: Object.assign(new Error("lookup"), { code: "ENOTFOUND" }),
          }),
        ),
      timeoutMs: 1_000,
    });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "unreachable",
      reason: "TMDB request failed (ENOTFOUND)",
    });
  });

  it.each([
    ["a line break", "eyJ.token\nsig"],
    ["a space", "eyJ.token sig"],
    ["a smart quote", "eyJ.token“sig"],
  ])(
    "rejects a token with %s without calling TMDB, since it cannot be a header",
    async (_, token) => {
      const { fetch, calls } = answering(200);
      const client = new TmdbClient({ fetch, timeoutMs: 1_000 });

      await expect(client.checkKey(token)).resolves.toEqual({
        kind: "rejected",
      });
      expect(calls).toEqual([]);
    },
  );

  it("reports a call that outlasts the timeout as unreachable", async () => {
    const client = new TmdbClient({ fetch: hanging, timeoutMs: 5 });

    await expect(client.checkKey(TOKEN)).resolves.toEqual({
      kind: "unreachable",
      reason: "TMDB did not answer within 5 ms",
    });
  });

  it("rethrows the caller's abort instead of reporting an outage", async () => {
    const client = new TmdbClient({ fetch: hanging, timeoutMs: 1_000 });
    const controller = new AbortController();
    const reason = new Error("scan cancelled");

    const check = client.checkKey(TOKEN, controller.signal);
    controller.abort(reason);

    await expect(check).rejects.toBe(reason);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a timeout of %s", (timeoutMs) => {
    expect(() => new TmdbClient({ timeoutMs })).toThrow(/timeoutMs/);
  });
});
