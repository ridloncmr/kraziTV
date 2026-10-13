// Test-only collection maintenance that runs no pass; production code must never import this module.
import type { CollectionMaintenance } from "../media-collections/maintenance/collection-maintenance.js";

/**
 * Counts maintenance requests and settles each at once without touching the
 * database, so a writer suite can assert it asked for a pass after its
 * commit, and suites about other domains run no background pass. Suites
 * about maintenance drive the real service.
 */
export class RecordingCollectionMaintenance implements Pick<
  CollectionMaintenance,
  "request" | "shutdown"
> {
  /** How many passes writers have asked for. */
  requests = 0;

  /** Optionally records lifecycle calls for composition startup and shutdown checks. */
  constructor(private readonly events?: string[]) {}

  /** Counts the request and settles at once, as a finished pass would. */
  request(): Promise<void> {
    this.requests += 1;
    this.events?.push("maintenance requested");
    return Promise.resolve();
  }

  /** Settles at once; no pass is ever running. */
  async shutdown(): Promise<void> {
    this.events?.push("maintenance stopped");
  }
}
