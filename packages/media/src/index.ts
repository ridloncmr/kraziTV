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
export {
  createMediaProber,
  type MediaProber,
  type MediaProberConfig,
} from "./probe/create-media-prober.js";
export type { MediaProbeOptions } from "./probe/ffprobe-media-prober.js";
export type { MediaProbeResult } from "./probe/parse-ffprobe-output.js";
export {
  MediaProbeError,
  type MediaProbeErrorCode,
} from "./probe/media-probe-error.js";
