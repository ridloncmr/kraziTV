import type { OutputReadinessInspector } from "../ffmpeg/contracts.js";

/**
 * Treats an explicit test marker as usable media output, so a test can feed a
 * fake FFmpeg process plain text and still decide exactly when the session
 * becomes ready, without building transport packets.
 */
export class MarkerReadinessInspector implements OutputReadinessInspector {
  /** Ready once any chunk carries the marker. */
  observe(chunk: Uint8Array): boolean {
    return Buffer.from(chunk).includes("usable-output");
  }
}
