import type { Channel } from "../http/contracts/channels.js";

/**
 * The channel the TV shows: the first of `preferredIds` still enabled, such
 * as the one asked for, then the one on screen, otherwise the first enabled
 * channel in lineup order. A disabled channel broadcasts nothing, so the TV
 * never tunes one.
 */
export function startingChannel(
  channels: readonly Channel[],
  preferredIds: readonly (string | undefined)[],
): Channel | undefined {
  const enabled = channels.filter((channel) => channel.enabled);
  for (const id of preferredIds) {
    const preferred = enabled.find((channel) => channel.id === id);
    if (preferred) return preferred;
  }
  return enabled.at(0);
}

/**
 * The enabled channel `step` places up (1) or down (-1) the lineup from
 * `currentId`, wrapping at either end as a TV's channel buttons do. A
 * current channel no longer enabled counts from where it sat.
 */
export function stepChannel(
  channels: readonly Channel[],
  currentId: string | undefined,
  step: 1 | -1,
): Channel | undefined {
  const count = channels.length;
  const found = channels.findIndex((channel) => channel.id === currentId);
  // With no current channel, up starts at the first and down at the last.
  const position = found !== -1 ? found : step === 1 ? -1 : count;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((position + step * offset) % count) + count) % count;
    const channel = channels[index];
    if (channel?.enabled && channel.id !== currentId) return channel;
  }
  return undefined;
}
