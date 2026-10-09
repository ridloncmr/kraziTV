import { join } from "node:path";
import { PROBE_RESULT } from "./discovery-fixtures.js";
// Test-only scanner metadata wiring; production code must never import this module.
import { MediaProbeError, TmdbClient, type MediaProber } from "@krazitv/media";

import type { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { ScriptedTmdbFetch } from "./scripted-tmdb-fetch.js";

/**
 * Scanner metadata as a server with no TMDB key has it: nothing is looked up
 * and nothing is settled, so scans record extras only. The client answers a
 * scripted TMDB, so no suite ever calls the real one.
 */
export function withoutTmdbKey(): ConstructorParameters<
  typeof CatalogScanner
>[0]["metadata"] {
  return {
    tmdbKeys: { readKey: async () => undefined },
    metadataMatches: { findSettledPathKeys: async () => new Set<string>() },
    tmdb: new TmdbClient({
      fetch: new ScriptedTmdbFetch().fetch,
      timeoutMs: 1_000,
    }),
  };
}

/** Movie facts used by scanner enrichment acceptance cases. */
export const SCAN_ALIEN = {
  id: 348,
  title: "Alien",
  releaseDate: "1979-05-25",
  genres: ["Horror"],
};
export const SCAN_THE_THINGS = [
  { id: 10785, title: "The Thing", releaseDate: "1951-04-06" },
  { id: 1091, title: "The Thing", releaseDate: "1982-06-25" },
  { id: 60935, title: "The Thing", releaseDate: "2011-10-12" },
];

/** Settles probes immediately; controlled probing is unnecessary for metadata-only races. */
export function metadataProber(
  root: string,
  failures: readonly string[],
): MediaProber {
  return {
    probe: async (path) => {
      if (failures.some((failure) => path === join(root, failure))) {
        throw new MediaProbeError("invalid_metadata", "not media");
      }
      return PROBE_RESULT;
    },
  };
}

/** Series facts for scanner episode enrichment, in the scripted provider shape. */
export const SCAN_FIREFLY = {
  id: 1437,
  name: "Firefly",
  firstAirDate: "2002-09-20",
  episodeCounts: { 0: 1, 1: 14, 2: 10 },
};
export const SCAN_DOCTOR_WHO = [
  {
    id: 121,
    name: "Doctor Who",
    firstAirDate: "1963-11-23",
    episodeCounts: { 1: 42 },
  },
  {
    id: 57243,
    name: "Doctor Who",
    firstAirDate: "2005-03-26",
    episodeCounts: { 1: 13 },
  },
];
