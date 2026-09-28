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
