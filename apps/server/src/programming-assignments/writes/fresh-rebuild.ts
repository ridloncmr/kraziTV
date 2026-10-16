import type { ScheduleInputChange } from "../../schedules/contracts.js";
import {
  findChannelEnabled,
  recordFreshRebuild,
  recordRebuildKey,
} from "../../schedules/persistence/schedule-repository.js";

/** A fresh rebuild's outcome; a retry under the same key rebuilds nothing again. */
type FreshRebuildResult =
  { kind: "rebuilt" } | { kind: "repeated" } | { kind: "channel_not_found" };

/**
 * The owner's explicit "Stop it now and rebuild the schedule" as a schedule
 * input change (programming spec 0004): advances the rebuild count once per
 * key, then interrupts the airing entry so the channel regenerates from now
 * on a fresh programming slate, its rounds, cooldown, and member positions
 * cleared and collection progress restored from the entries kept. A retry
 * with the same key changes nothing, so the caller can repeat the worker
 * stop that may have failed.
 */
export function freshRebuildChange(
  channelId: string,
  key: string,
): ScheduleInputChange<FreshRebuildResult> {
  return async (trx) => {
    if ((await findChannelEnabled(trx, channelId)) === undefined) {
      return { value: { kind: "channel_not_found" }, affectedChannelIds: [] };
    }
    const recorded = await recordFreshRebuild(trx, channelId, key);
    if (recorded === "repeated") {
      return { value: { kind: "repeated" }, affectedChannelIds: [] };
    }
    return {
      value: { kind: "rebuilt" },
      affectedChannelIds: [channelId],
      interruptedChannelIds: [channelId],
      // A first schedule this commit created learns the key afterwards.
      afterRegeneration:
        recorded === "unscheduled"
          ? (after) => recordRebuildKey(after, channelId, key)
          : undefined,
    };
  };
}
