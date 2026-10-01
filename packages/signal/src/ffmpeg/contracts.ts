/** Decides when an encoder's output is usable enough to commit a session. */
export interface OutputReadinessInspector {
  /** Reports whether the output observed so far satisfies session readiness. */
  observe(chunk: Uint8Array): boolean;
}
