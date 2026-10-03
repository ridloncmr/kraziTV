// Deterministic discovery and probe output for catalog-scan tests only.
import type {
  DiscoveredMediaFile,
  DiscoverMediaFilesOptions,
} from "@krazitv/media";

/** The discovery function a scanner accepts, so tests can fake traversal. */
export type Discover = (
  rootPath: string,
  options?: DiscoverMediaFilesOptions,
) => Promise<DiscoveredMediaFile[]>;

/** A successful probe result for any file; tests vary the files, not the metadata. */
export const PROBE_RESULT = { durationMs: 2_000, hasAudio: true };

/** Builds discovery output for files directly under the fixture root, in the order given. */
export function discoveredFiles(...names: string[]): DiscoveredMediaFile[] {
  return names.map((name) => ({
    path: `/media/movies/${name}.mkv`,
    pathKey: `/media/movies/${name}.mkv`,
    title: name,
  }));
}
