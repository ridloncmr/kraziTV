/** The normalized facts one probe contributes before any metadata enrichment. */
export interface MediaProbeResult {
  /** Positive whole milliseconds, rounded once from ffprobe's seconds. */
  durationMs: number;
  hasAudio: boolean;
  /** False for audio-only media, including media whose only picture is cover art. */
  hasVideo: boolean;
}

export interface MediaProbeOptions {
  signal?: AbortSignal;
}

/** Probes one media file at a time; concurrency is the caller's policy. */
export interface MediaProber {
  probe(path: string, options?: MediaProbeOptions): Promise<MediaProbeResult>;
}
