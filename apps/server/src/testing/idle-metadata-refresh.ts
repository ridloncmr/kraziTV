// Test-only TMDB refresh that never runs a pass; production code must never import this module.
import type { MetadataRefreshService } from "../content-metadata/refresh/metadata-refresh-service.js";

/**
 * Accepts checks and stops without touching the database or TMDB, so server
 * and scanner suites run with no background pass racing what they assert.
 * Refresh suites drive the real service directly.
 */
export class IdleMetadataRefresh implements Pick<
  MetadataRefreshService,
  "checkNow" | "shutdown"
> {
  /** Optionally records lifecycle calls for composition shutdown checks. */
  constructor(private readonly events?: string[]) {}

  /** Checks nothing; no pass runs. */
  checkNow(): void {
    this.events?.push("refresh started");
  }

  /** Settles at once; nothing is running. */
  async shutdown(): Promise<void> {
    this.events?.push("refresh stopped");
  }
}
