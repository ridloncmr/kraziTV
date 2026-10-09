import { join, sep } from "node:path";

import { MediaProbeError } from "@krazitv/media";
import { describe, expect, it } from "vitest";

import type { CatalogCandidate } from "../contracts.js";
import {
  createCatalogCandidate,
  validateCatalogCandidate,
} from "./catalog-candidate.js";

// Built with the platform's separators, as discovery produces them.
const ROOT = join(sep, "media", "TV");

const FILE = {
  path: join(ROOT, "Show.mkv"),
  pathKey: join(ROOT, "Show.mkv"),
  title: "Show",
};

const PROBED = {
  kind: "probed",
  probedAt: 5,
  result: { durationMs: 1_500, hasAudio: true, hasVideo: false },
} as const;

describe("createCatalogCandidate", () => {
  it("titles a file from its path hints below the media root", () => {
    const path = join(ROOT, "Firefly", "Season 1", "s01e05.mp4");
    expect(
      createCatalogCandidate(
        { path, pathKey: path, title: "s01e05" },
        PROBED,
        ROOT,
      ),
    ).toMatchObject({ path, title: "Firefly – S01E05" });
  });

  it("keeps the filename title when the hints name nothing better", () => {
    const path = join(ROOT, "s01e05.mp4");
    expect(
      createCatalogCandidate(
        { path, pathKey: path, title: "s01e05" },
        PROBED,
        ROOT,
      ),
    ).toMatchObject({ title: "s01e05" });
  });

  it("stages a successful probe as an available candidate", () => {
    expect(createCatalogCandidate(FILE, PROBED, ROOT)).toEqual({
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
      createCatalogCandidate(
        FILE,
        {
          kind: "failed",
          probedAt: 5,
          error: new MediaProbeError(
            "timed_out",
            "ffprobe timed out after 30000 ms",
          ),
        },
        ROOT,
      ),
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
