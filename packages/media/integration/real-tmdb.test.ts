import { beforeAll, describe, expect, it } from "vitest";

import { TmdbClient } from "../src/index.js";

// Opt-in: `npm run test:tmdb` with TMDB_API_KEY set to a real API Read Access
// Token. It fails rather than skips without one, as the ffprobe suite does.
const apiKey = process.env.TMDB_API_KEY ?? "";

beforeAll(() => {
  if (apiKey === "") {
    throw new Error(
      "TMDB_API_KEY is not set; set it to a TMDB API Read Access Token",
    );
  }
});

describe("real TMDB", () => {
  const client = new TmdbClient({ timeoutMs: 10_000 });

  it("accepts the configured token", async () => {
    await expect(client.checkKey(apiKey)).resolves.toEqual({ kind: "valid" });
  });

  it("rejects a token TMDB never issued", async () => {
    await expect(client.checkKey("not-a-real-token")).resolves.toEqual({
      kind: "rejected",
    });
  });
});
