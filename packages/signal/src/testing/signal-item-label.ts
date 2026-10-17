import type { SignalPlayoutItem } from "../signal-packager/contracts.js";

/**
 * Names a packaged item for sequence assertions: a program by its schedule
 * entry, filler by its message and airtime, so tests read as what aired.
 */
export function signalItemLabel(item: SignalPlayoutItem): string {
  return item.kind === "program"
    ? item.scheduleEntryId
    : `filler(${item.message}, ${item.airtimeMs}ms)`;
}
