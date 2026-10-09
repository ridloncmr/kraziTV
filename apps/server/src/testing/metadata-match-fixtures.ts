import type { MovieLookup, PathHints } from "@krazitv/media";
import type {
  CatalogCandidate,
  MetadataMatchRecord,
} from "../catalog-scan/contracts.js";
import { FIXTURE_TIME } from "./catalog-fixtures.js";
/** Lookup time shared by staged records and their expected persistence. */
export const LOOKED_UP_AT = FIXTURE_TIME + 45_000;
/** A matched movie and its path evidence for metadata writer tests. */
export const HINTS: PathHints = {
  title: "Alien",
  year: 1979,
  extra: false,
  strength: "strong",
};
export const ALIEN: MovieLookup = {
  kind: "matched",
  query: { title: "Alien", year: 1979 },
  movie: {
    id: 348,
    title: "Alien",
    releaseDate: "1979-05-25",
    posterPath: "/alien.jpg",
    genres: ["Horror", "Science Fiction"],
    franchise: { id: 8091, name: "Alien Collection" },
    description: "In space…",
  },
};

/** Builds a schedulable candidate for metadata persistence tests. */
export function candidate(pathKey: string): CatalogCandidate {
  return {
    path: pathKey,
    pathKey,
    title: "title",
    probedAt: FIXTURE_TIME,
    status: "available",
    durationMs: 6_000_000,
    hasAudio: true,
    hasVideo: true,
  };
}

/** Stages one lookup with the fixture hints and duration. */
export function lookedUp(
  pathKey: string,
  lookup: MovieLookup,
): MetadataMatchRecord {
  return {
    kind: "looked_up",
    pathKey,
    hints: HINTS,
    lookedUpAt: LOOKED_UP_AT,
    durationMs: 6_000_000,
    lookup,
  };
}
