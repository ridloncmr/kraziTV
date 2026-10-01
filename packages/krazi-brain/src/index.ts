/**
 * kraziBrain: decides what plays, when it plays, and why. Provider-neutral
 * scheduling and playout decisions live here; FFmpeg, HTTP, SQLite, and
 * provider formatting do not.
 */
export type ChannelId = string;
export type ChannelNumber = string;

export type Channel = {
  id: ChannelId;
  number: ChannelNumber;
  name: string;
};

export function describeChannel(channel: Channel): string {
  return `${channel.number} - ${channel.name}`;
}
