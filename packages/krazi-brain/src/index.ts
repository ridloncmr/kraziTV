/**
 * kraziBrain: decides what plays, when it plays, and why. Provider-neutral
 * scheduling and playout decisions live here; FFmpeg, HTTP, SQLite, and
 * provider formatting do not.
 */
export type { Channel, ChannelId, ChannelNumber } from "./channels/channel.js";
export {
  compareChannelNumbers,
  parseChannelNumber,
} from "./channels/channel-number.js";
