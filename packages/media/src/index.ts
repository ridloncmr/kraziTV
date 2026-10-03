export {
  currentPathPlatform,
  normalizeMediaPath,
  type NormalizedMediaPath,
} from "./paths/media-path.js";
export {
  discoverMediaFiles,
  type DiscoverMediaFilesOptions,
  type DiscoveredMediaFile,
} from "./discovery/discover-media-files.js";
export { MediaDiscoveryError } from "./discovery/media-discovery-error.js";
export { createMediaProber } from "./create-media-prober.js";
export type {
  MediaProbeOptions,
  MediaProbeResult,
  MediaProber,
} from "./probe/contracts.js";
export { MediaProbeError } from "./probe/media-probe-error.js";
