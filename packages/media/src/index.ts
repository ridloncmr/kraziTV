export type MediaProbeInput = {
  path: string;
};

export type MediaProbeResult = {
  path: string;
  durationMs: number;
  /** Normalized stream-presence fact used by the packaging projection. */
  hasAudio: boolean;
};

export {
  currentPathPlatform,
  normalizeMediaPath,
  type NormalizedMediaPath,
  type PathPlatform,
} from "./paths/media-path.js";
export {
  discoverMediaFiles,
  type DiscoverMediaFilesOptions,
  type DiscoveredMediaFile,
} from "./discovery/discover-media-files.js";
export {
  MediaDiscoveryError,
  type MediaDiscoveryErrorCode,
} from "./discovery/media-discovery-error.js";
