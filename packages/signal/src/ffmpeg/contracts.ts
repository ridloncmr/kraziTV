/** Decides when an FFmpeg process's output is usable enough to commit a session. */
export interface OutputReadinessInspector {
  /** Reports whether the output observed so far satisfies session readiness. */
  observe(chunk: Uint8Array): boolean;
}

/**
 * Where forwarded transport packets go, as chunks of whole packets: the
 * session's output, or a prepared item's held output until its commit
 * (ADR 0016).
 */
export interface PacketSink {
  write(packets: Buffer): void;
}
