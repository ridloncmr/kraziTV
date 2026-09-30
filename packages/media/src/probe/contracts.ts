import type { MediaProbeResult } from "./parse-ffprobe-output.js";

export interface MediaProbeOptions {
  signal?: AbortSignal;
}

/** Probes one media file at a time; concurrency is the caller's policy. */
export interface MediaProber {
  probe(path: string, options?: MediaProbeOptions): Promise<MediaProbeResult>;
}
