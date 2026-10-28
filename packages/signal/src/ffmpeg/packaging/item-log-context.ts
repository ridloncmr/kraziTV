import { SignalError } from "../../errors.js";
import type { LogContext } from "../../runtime/signal-logger.js";
import type { SignalPlayoutItem } from "../../signal-packager/contracts.js";

/**
 * Builds safe item identity context without retaining or logging its media
 * path. The one place packaging names an item in logs and diagnostics, so the
 * path can never leak through one call site that spelled the fields out.
 */
export function itemContext(item: SignalPlayoutItem): LogContext {
  if (item.kind === "filler") {
    return { channelId: item.channelId, item: "filler" };
  }
  return {
    channelId: item.channelId,
    scheduleEntryId: item.scheduleEntryId,
    mediaItemId: item.mediaItemId,
  };
}

/** Names why an item failed in a log without carrying its stderr or cause. */
export function failureSummary(error: unknown): LogContext {
  if (!(error instanceof SignalError)) return { code: "packaging_failed" };
  const { reason } = error.details;
  return reason === undefined
    ? { code: error.code }
    : { code: error.code, reason };
}
