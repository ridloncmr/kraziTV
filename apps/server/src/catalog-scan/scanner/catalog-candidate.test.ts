import { MediaProbeError } from "@krazitv/media";
import { describe, expect, it } from "vitest";

import type { CatalogCandidate } from "../contracts.js";
import {
  createCatalogCandidate,
  validateCatalogCandidate,
} from "./catalog-candidate.js";

const FILE = {
  path: "/media/Show.mkv",
  pathKey: "/media/Show.mkv",
  title: "Show",
};

describe("createCatalogCandidate", () => {
  it("stages a successful probe as an available candidate", () => {
    expect(
      createCatalogCandidate(FILE, {
        kind: "probed",
        probedAt: 5,
        result: { durationMs: 1_500, hasAudio: true, hasVideo: false },
      }),
    ).toEqual({
      ...FILE,
      probedAt: 5,
      status: "available",
      durationMs: 1_500,
      hasAudio: true,
      hasVideo: false,
    });
  });

  it("stages a probe failure with its code and sanitized message", () => {
    expect(
      createCatalogCandidate(FILE, {
        kind: "failed",
        probedAt: 5,
        error: new MediaProbeError(
          "timed_out",
          "ffprobe timed out after 30000 ms",
        ),
      }),
    ).toEqual({
      ...FILE,
      probedAt: 5,
      status: "probe_failed",
      probeError: "timed_out: ffprobe timed out after 30000 ms",
    });
  });
});

describe("validateCatalogCandidate", () => {
  const valid: CatalogCandidate = {
    ...FILE,
    probedAt: 5,
    status: "available",
    durationMs: 1,
    hasAudio: false,
    hasVideo: true,
  };

  it("accepts a candidate that satisfies the catalog invariants", () => {
    expect(() => validateCatalogCandidate(valid)).not.toThrow();
  });

  it.each<[string, CatalogCandidate]>([
    ["a zero duration", { ...valid, durationMs: 0 }],
    ["a fractional duration", { ...valid, durationMs: 1.5 }],
    [
      "an unsafe duration",
      { ...valid, durationMs: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["an empty identity key", { ...valid, pathKey: "" }],
    ["an empty title", { ...valid, title: " " }],
    ["a negative probe time", { ...valid, probedAt: -1 }],
    [
      "a blank probe error",
      { ...FILE, probedAt: 5, status: "probe_failed", probeError: "  " },
    ],
  ])("rejects %s", (_name, candidate) => {
    expect(() => validateCatalogCandidate(candidate)).toThrow(
      /Invalid catalog candidate/,
    );
  });
});
