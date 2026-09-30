import { NodeProcessSpawner } from "./process/node-process-spawner.js";
import type { MediaProber } from "./probe/contracts.js";
import { FfprobeMediaProber } from "./probe/ffprobe-media-prober.js";

export interface MediaProberConfig {
  /** Validated ffprobe executable, e.g. the server's resolved `FFPROBE_PATH`. */
  ffprobePath: string;
  /** Validated positive per-probe timeout, e.g. `FFPROBE_TIMEOUT_MS`. */
  timeoutMs: number;
}

/** Builds the production prober without exposing the process seam. */
export function createMediaProber(config: MediaProberConfig): MediaProber {
  return new FfprobeMediaProber({
    ...config,
    spawner: new NodeProcessSpawner(),
  });
}
