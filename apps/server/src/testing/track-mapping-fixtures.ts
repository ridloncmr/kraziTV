import type { FastifyInstance } from "fastify";
import { send } from "./api-requests.js";
import {
  idOf,
  scanThroughRoutes as scan,
  startEnrichmentServer,
} from "./enrichment-scan.js";
export const MINUTE = 60_000;

// Two discs of season 1, with a play-all title and a short extra on disc 1.
const DISC_1 = "Some Show/Season 1/Disc 1";
const DISC_2 = "Some Show/Season 1/Disc 2";
export const TRACKS = {
  playAll: `${DISC_1}/t_00.mkv`,
  first: `${DISC_1}/t_01.mkv`,
  second: `${DISC_1}/t_02.mkv`,
  short: `${DISC_1}/t_03.mkv`,
  third: `${DISC_2}/t_00.mkv`,
};
const DURATIONS = new Map([
  [TRACKS.playAll, 88 * MINUTE],
  [TRACKS.first, 44 * MINUTE],
  [TRACKS.second, 44 * MINUTE],
  [TRACKS.short, 3 * MINUTE],
  [TRACKS.third, 45 * MINUTE],
]);
// Another season's disc, and an ordinary episode, which map apart.
export const OTHER_SEASON = "Some Show/Season 2/Disc 1/t_00.mkv";
export const EPISODE = "Some Show/Season 1/s01e09.mkv";

export const SOME_SHOW = {
  id: 4242,
  name: "Some Show",
  firstAirDate: "2010-01-04",
  episodeCounts: { 1: 4 },
  episodeRuntime: 44,
};

type Server = FastifyInstance;

// Boots a server over the disc rip with Some Show known to TMDB, and scans.
export async function scanned(options: { key?: boolean } = {}) {
  const context = await startEnrichmentServer({
    files: [...Object.values(TRACKS), OTHER_SEASON, EPISODE],
    durations: DURATIONS,
    ...options,
  });
  context.tmdb.series.push(SOME_SHOW);
  await scan(context.server);
  return context;
}

// The track mapping routes of the item at `file`.
export async function mappingOf(server: Server, file: string) {
  return `/metadata/track-mappings/${await idOf(server, file)}`;
}

// Applies `episodes` by track file, a null episode skipping that track.
export async function apply(
  server: Server,
  episodes: [string, number | null][],
) {
  return send(server, "POST", await mappingOf(server, TRACKS.first), {
    tmdbSeriesId: SOME_SHOW.id,
    season: 1,
    rows: await Promise.all(
      episodes.map(async ([file, episodeNumber]) => ({
        mediaItemId: await idOf(server, file),
        episodeNumber,
      })),
    ),
  });
}

// The proposal's rows with each track's file below the root.
export const ACCEPTED: [string, number | null][] = [
  [TRACKS.playAll, null],
  [TRACKS.first, 1],
  [TRACKS.second, 2],
  [TRACKS.short, null],
  [TRACKS.third, 3],
];
