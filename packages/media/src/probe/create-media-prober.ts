import {
  FfprobeMediaProber,
  type MediaProbeOptions,
} from "./ffprobe-media-prober.js";
import type { MediaProbeResult } from "./parse-ffprobe-output.js";
import { NodeProcessSpawner } from "./process/node-process-spawner.js";

export interface MediaProberConfig {
  /** Validated ffprobe executable, e.g. the server's resolved `FFPROBE_PATH`. */
  ffprobePath: string;
  /** Validated positive per-probe timeout, e.g. `FFPROBE_TIMEOUT_MS`. */
  timeoutMs: number;
}

/** Probes one media file at a time; concurrency is the caller's policy. */
export interface MediaProber {
  probe(path: string, options?: MediaProbeOptions): Promise<MediaProbeResult>;
}

/** Builds the production prober without exposing the process seam. */
export function createMediaProber(config: MediaProberConfig): MediaProber {
  return new FfprobeMediaProber({
    ...config,
    spawner: new NodeProcessSpawner(),
  });
}
