export {
  currentPathPlatform,
  mediaPathSegments,
  normalizeMediaPath,
  type NormalizedMediaPath,
} from "./paths/media-path.js";
export { derivePathHints } from "./path-hints/derive-path-hints.js";
export type { PathHints } from "./path-hints/contracts.js";
export { seriesEpisode } from "./path-hints/series-episode.js";
export {
  lookUpEpisodes,
  lookUpEpisodesInSeries,
  type EpisodeHints,
  type EpisodeLookup,
} from "./metadata-matching/look-up-episodes.js";
export {
  lookUpMovie,
  lookUpMovieById,
  type MovieLookup,
} from "./metadata-matching/look-up-movie.js";
export { lookUpRuntimeMs } from "./metadata-matching/look-up-runtime.js";
export { fallbackTitle } from "./path-hints/fallback-title.js";
export {
  discoverMediaFiles,
  type DiscoverMediaFilesOptions,
  type DiscoveredMediaFile,
} from "./discovery/files/discover-media-files.js";
export { MediaDiscoveryError } from "./discovery/media-discovery-error.js";
export { listMediaFolders } from "./discovery/folders/list-media-folders.js";
export { createMediaProber } from "./create-media-prober.js";
export type {
  MediaProbeOptions,
  MediaProbeResult,
  MediaProber,
} from "./probe/contracts.js";
export { MediaProbeError } from "./probe/media-probe-error.js";
export { TmdbClient, type TmdbKeyCheck } from "./tmdb/tmdb-client.js";
