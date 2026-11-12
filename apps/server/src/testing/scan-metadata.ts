// Test-only scanner metadata wiring; production code must never import this module.

import { join } from "node:path";

import { MediaProbeError, TmdbClient, type MediaProber } from "@krazitv/media";
import type { Kysely } from "kysely";

import type { CatalogScanner } from "../catalog-scan/scanner/catalog-scanner.js";
import { MetadataMatchRepository } from "../content-metadata/persistence/metadata-match-repository.js";
import { TmdbKeyService } from "../content-metadata/tmdb-key/tmdb-key-service.js";
import type { DatabaseSchema } from "../database/schema/database-schema.js";
import { PROBE_RESULT } from "./discovery-fixtures.js";
import { ScriptedTmdbFetch } from "./scripted-tmdb-fetch.js";

/** What a catalog scanner reads keys, decisions, and TMDB through. */
type ScannerMetadata = ConstructorParameters<
  typeof CatalogScanner
>[0]["metadata"];

/**
 * Scanner metadata as a server with no TMDB key has it: nothing is looked up
 * and nothing is settled, so scans record extras only and retries are
 * refused for the missing key. A retry scope reads as the real repository
 * reads an uncataloged item: unknown, or a root with nothing to retry. The
 * client answers a scripted TMDB, so no suite ever calls the real one.
 */
export function withoutTmdbKey(): ScannerMetadata {
  return {
    tmdbKeys: { readKey: async () => undefined },
    metadataMatches: {
      findSettledPathKeys: async () => new Set<string>(),
      findRetryItems: async (scope) =>
        scope.scope === "outstanding"
          ? { rootId: scope.mediaRootId, items: [] }
          : undefined,
    },
    tmdb: new TmdbClient({
      fetch: new ScriptedTmdbFetch().fetch,
      timeoutMs: 1_000,
    }),
  };
}

/** The key the scripted TMDB from `scriptedTmdb` accepts, as an owner pastes it. */
export const SCRIPTED_TMDB_KEY = "eyJ.owner-token.sig";

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

/**
 * A scripted TMDB knowing the fixture movies and accepting the owner's key,
 * and the real client over it. A test adds the series it needs.
 */
export function scriptedTmdb() {
  const tmdb = new ScriptedTmdbFetch();
  tmdb.movies.push(SCAN_ALIEN, ...SCAN_THE_THINGS);
  tmdb.validKeys.add(SCRIPTED_TMDB_KEY);
  const client = new TmdbClient({ fetch: tmdb.fetch, timeoutMs: 1_000 });
  return { tmdb, client };
}

/**
 * Scanner metadata as a running server has it: the real key service and
 * match repository over `db`, asking `client`. The key service is returned
 * for the server's key routes too, one instance as index.ts shares it, so a
 * key saved through Set up TMDB is the key a lookup reads, and the files a
 * keyless scan left never looked up are the ones an all-roots lookup finds.
 */
export function withScriptedTmdb(
  db: Kysely<DatabaseSchema>,
  client: TmdbClient,
): { tmdbKeys: TmdbKeyService; metadata: ScannerMetadata } {
  const tmdbKeys = new TmdbKeyService(db, client);
  return {
    tmdbKeys,
    metadata: {
      tmdbKeys,
      metadataMatches: new MetadataMatchRepository(db),
      tmdb: client,
    },
  };
}

/**
 * Settles probes immediately; controlled probing is unnecessary for
 * metadata-only races. `durations` is read at each probe, so a test can
 * replace a file between scans by changing its entry.
 */
export function metadataProber(
  root: string,
  failures: readonly string[],
  durations: ReadonlyMap<string, number> = new Map(),
): MediaProber {
  return {
    probe: async (path) => {
      if (failures.some((failure) => path === join(root, failure))) {
        throw new MediaProbeError("invalid_metadata", "not media");
      }
      const file = [...durations.keys()].find(
        (key) => path === join(root, key),
      );
      return file === undefined
        ? PROBE_RESULT
        : { ...PROBE_RESULT, durationMs: durations.get(file)! };
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

/** Ambiguous series candidates with runtimes; both list the seasons a test folder holds. */
export const CHOICE_DOCTOR_WHO_1963 = {
  ...SCAN_DOCTOR_WHO[0],
  episodeCounts: { 1: 42, 2: 40 },
  episodeRuntime: 25,
};
export const CHOICE_DOCTOR_WHO_2005 = {
  ...SCAN_DOCTOR_WHO[1],
  episodeCounts: { 1: 13, 2: 13 },
  episodeRuntime: 45,
};
