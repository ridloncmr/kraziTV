export type ChannelId = string;

export type Channel = {
  id: ChannelId;
  number: number;
  name: string;
};

export function describeChannel(channel: Channel): string {
  return `${channel.number} - ${channel.name}`;
}
