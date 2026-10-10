import type {
  Channel,
  ChannelState,
  ContentMetadata,
  MatchCandidates,
  MediaCollection,
  MediaItem,
  SeriesSearch,
  TrackFolder,
  TrackProposal,
} from "../http/contracts.js";

/** A media item's metadata before any lookup: every fact unknown. */
export const noMetadata: ContentMetadata = {
  matchState: "not_looked_up",
  lookupError: null,
  fileChanged: false,
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

/** A matched movie whose newly probed duration needs review. */
export const CHANGED = {
  ...ALIEN,
  metadata: { ...ALIEN.metadata, fileChanged: true },
};

/** A disc-track file nothing has decided yet, and a second track on its disc. */
export const DISC_TRACK = itemWith("Some Show – Disc 1 Track 0", {});
const SECOND_TRACK = itemWith("Some Show – Disc 1 Track 1", {});

/** The folder DISC_TRACK maps with: two tracks, the second a short extra. */
export const TRACK_FOLDER: TrackFolder = {
  series: "Some Show",
  season: 1,
  tracks: [
    {
      mediaItemId: DISC_TRACK.id,
      path: DISC_TRACK.path,
      disc: 1,
      track: 0,
      durationMs: 44 * 60_000,
    },
    {
      mediaItemId: SECOND_TRACK.id,
      path: SECOND_TRACK.path,
      disc: 1,
      track: 1,
      durationMs: 3 * 60_000,
    },
  ],
};

/** The one TMDB series matching "Some Show". */
export const SOME_SHOW_SEARCH: SeriesSearch = {
  candidates: [
    {
      tmdbId: 4242,
      title: "Some Show",
      releaseDate: "2010-01-04",
      posterPath: null,
    },
  ],
};

/** The proposal for TRACK_FOLDER: the first track as E1, the extra skipped. */
export const TRACK_PROPOSAL: TrackProposal = {
  rows: [
    { mediaItemId: DISC_TRACK.id, episodeNumber: 1 },
    { mediaItemId: SECOND_TRACK.id, episodeNumber: null },
  ],
  episodes: [
    { number: 1, title: "Pilot", runtimeMs: 44 * 60_000 },
    { number: 2, title: "Second", runtimeMs: null },
  ],
};
