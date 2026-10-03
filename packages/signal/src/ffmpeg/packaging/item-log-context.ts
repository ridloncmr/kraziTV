import type { LogContext } from "../../runtime/signal-logger.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";

/**
 * Builds safe item identity context without retaining or logging its media
 * path. The one place packaging names an item in logs and diagnostics, so the
 * path can never leak through one call site that spelled the fields out.
 */
export function itemContext(item: SignalPlayoutItem): LogContext {
  return {
    channelId: item.channelId,
    scheduleEntryId: item.scheduleEntryId,
    mediaItemId: item.mediaItemId,
  };
}
