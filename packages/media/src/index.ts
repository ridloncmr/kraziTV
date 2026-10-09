export {
  currentPathPlatform,
  mediaPathSegments,
  normalizeMediaPath,
  type NormalizedMediaPath,
} from "./paths/media-path.js";
export { derivePathHints } from "./path-hints/derive-path-hints.js";
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
