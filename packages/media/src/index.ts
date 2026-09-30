export type MediaProbeInput = {
  path: string;
};

export type MediaProbeResult = {
  path: string;
  durationMs: number;
  /** Normalized stream-presence fact used by the packaging projection. */
  hasAudio: boolean;
};
