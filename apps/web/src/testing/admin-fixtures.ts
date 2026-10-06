import type {
  Channel,
  ChannelState,
  MediaCollection,
  MediaItem,
} from "../http/contracts.js";

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
    },
    {
      id: "a",
      title: "Zulu",
      path: "/media/zulu.mp4",
      status: "missing",
      durationMs: 1_300_000,
      probeError: null,
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
