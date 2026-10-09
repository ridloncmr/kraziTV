import type {
  Channel,
  ChannelState,
  ContentMetadata,
  MatchCandidates,
  MediaCollection,
  MediaItem,
} from "../http/contracts.js";

/** A media item's metadata before any lookup: every fact unknown. */
export const noMetadata: ContentMetadata = {
  matchState: "not_looked_up",
  lookupError: null,
  title: null,
  seriesName: null,
  seasonNumber: null,
  episodeNumber: null,
  lastEpisodeNumber: null,
  releaseDate: null,
  genres: [],
  franchiseName: null,
  description: null,
  posterPath: null,
  refreshedAt: null,
  refreshError: null,
  tmdbDataExpired: false,
  tags: [],
  correctedFields: [],
};

/** Wire fixtures contain ISO instants and milliseconds, with membership order distinct from title and ID order. */
export const adminFixtures: {
  channels: Channel[];
  media: MediaItem[];
  collections: MediaCollection[];
  now: ChannelState;
} = {
  channels: [
    { id: "one", number: "69", name: "Northwoods TV", enabled: true },
    { id: "two", number: "70", name: "Second channel", enabled: true },
  ],
  media: [
    {
      id: "z",
      title: "Alpha",
      path: "/media/alpha.mp4",
      status: "available",
      durationMs: 1_200_000,
      probeError: null,
      metadata: noMetadata,
    },
    {
      id: "a",
      title: "Zulu",
      path: "/media/zulu.mp4",
      status: "missing",
      durationMs: 1_300_000,
      probeError: null,
      metadata: noMetadata,
    },
  ],
  collections: [{ id: "favorites", name: "Favorites" }],
  now: {
    evaluatedAt: "2026-10-05T15:00:00.000Z",
    currentItem: {
      title: "Alpha",
      startsAt: "2026-10-05T14:50:00.000Z",
      endsAt: "2026-10-05T15:10:00.000Z",
      offsetMs: 600_000,
    },
    nextItem: {
      title: "Zulu",
      startsAt: "2026-10-05T15:10:00.000Z",
      endsAt: "2026-10-05T15:31:40.000Z",
    },
  },
};

/** A listed item titled `title` whose metadata overrides the unknown defaults. */
export function itemWith(title: string, metadata: Partial<ContentMetadata>) {
  return {
    ...adminFixtures.media[0],
    id: title,
    title,
    path: `/media/${title}.mkv`,
    metadata: { ...noMetadata, ...metadata },
  } satisfies MediaItem;
}

export const ALIEN = itemWith("Alien (1979)", {
  matchState: "matched",
  title: "Alien",
  releaseDate: "1979-05-25",
  genres: ["Horror", "Science Fiction"],
  franchiseName: "Alien Collection",
  description: "In space…",
  posterPath: "/alien.jpg",
  refreshedAt: "2026-10-09T12:00:00.000Z",
});

export const FIREFLY = itemWith("Firefly – S01E05–E06", {
  matchState: "matched",
  title: "Safe / Our Mrs. Reynolds",
  seriesName: "Firefly",
  seasonNumber: 1,
  episodeNumber: 5,
  lastEpisodeNumber: 6,
  posterPath: "/firefly.jpg",
  refreshedAt: "2026-10-09T12:00:00.000Z",
});

export const OUTAGE = itemWith("Outage", {
  matchState: "unmatched",
  lookupError: "TMDB answered HTTP 503",
});

export const THING = itemWith("The Thing", { matchState: "ambiguous" });
export const WRONG = itemWith("Wrong", { matchState: "rejected" });

/** The Thing's three candidates, one with no year or poster. */
export const THE_THINGS: MatchCandidates = {
  kind: "movie",
  durationMs: 109 * 60_000,
  candidates: [
    {
      tmdbId: 10785,
      title: "The Thing",
      releaseDate: "1951-04-06",
      posterPath: "/thing-1951.jpg",
    },
    {
      tmdbId: 1091,
      title: "The Thing",
      releaseDate: "1982-06-25",
      posterPath: "/thing-1982.jpg",
    },
    {
      tmdbId: 60935,
      title: "The Thing",
      releaseDate: null,
      posterPath: null,
    },
  ],
};
