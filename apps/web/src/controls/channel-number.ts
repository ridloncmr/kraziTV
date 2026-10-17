import type { Channel } from "../http/contracts.js";

/**
 * Names a channel the server identified only by ID by its number, or by
 * the ID until the channel list loads, so a refusal never names nothing.
 */
export function channelNumberIn(
  channels: readonly Channel[] | undefined,
  channelId: string,
): string {
  return (
    channels?.find((channel) => channel.id === channelId)?.number ?? channelId
  );
}
