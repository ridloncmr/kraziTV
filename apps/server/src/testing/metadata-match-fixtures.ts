import { derivePathHints } from "@krazitv/media";
import type { HintedCandidate } from "../catalog-scan/contracts.js";
import type { EpisodeLookup, MovieLookup, PathHints } from "@krazitv/media";
import type {
  CatalogCandidate,
  MetadataMatchRecord,
} from "../catalog-scan/contracts.js";
import { FIXTURE_TIME, itemFixture } from "./catalog-fixtures.js";
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

/** A matched two-part episode under a series folder, and its path evidence. */
export const EPISODE_HINTS: PathHints = {
  series: "Firefly",
  seriesFolder: "Firefly",
  season: 1,
  episode: { first: 5, last: 6 },
  extra: false,
  strength: "strong",
};
export const FIREFLY_EPISODE: EpisodeLookup = {
  kind: "matched",
  query: { title: "Firefly" },
  series: {
    id: 1437,
    title: "Firefly",
    releaseDate: "2002-09-20",
    posterPath: "/firefly.jpg",
    genres: ["Drama", "Sci-Fi & Fantasy"],
    description: "Captain Malcolm Reynolds…",
    seasons: [{ number: 1, episodeCount: 14 }],
  },
  season: 1,
  episodes: [
    {
      number: 5,
      title: "Safe",
      airDate: "2002-10-18",
      description: "Simon is kidnapped.",
    },
    { number: 6, title: "Our Mrs. Reynolds" },
  ],
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
  lookup: MovieLookup | EpisodeLookup,
  hints: PathHints = HINTS,
): MetadataMatchRecord {
  return {
    kind: "looked_up",
    pathKey,
    hints,
    lookedUpAt: LOOKED_UP_AT,
    durationMs: 6_000_000,
    lookup,
  };
}

// A discovered file at a path below its media root, with its real path hints.
export function hinted(
  relativePath: string,
  overrides: Partial<CatalogCandidate> = {},
): HintedCandidate {
  return {
    candidate: { ...candidate(relativePath), ...overrides } as CatalogCandidate,
    hints: derivePathHints(relativePath.split("/")),
  };
}

/** Episode rows and a legacy movie reference used by migration compatibility tests. */
export const EPISODE_FACTS = {
  media_item_id: itemFixture.id,
  content_type: "episode",
  title: "The Train Job",
  release_date: "2002-09-20",
  genres: '["Drama"]',
  franchise_tmdb_id: null,
  franchise_name: null,
  description: "Mal takes a job.",
  poster_path: "/firefly.jpg",
  series_tmdb_id: 1437,
  series_name: "Firefly",
  season_number: 1,
  episode_number: 5,
  last_episode_number: 6,
} as const;

export const EPISODE_REF = {
  media_item_id: itemFixture.id,
  provider: "tmdb",
  external_kind: "movie",
  external_id: 348,
  fetched_at: FIXTURE_TIME,
} as const;
