export type ChannelId = string;

declare const canonicalChannelNumber: unique symbol;

/**
 * A canonical channel number, such as `69` or `69.1`. Branded so the compiler
 * only accepts values that came through `parseChannelNumber`.
 */
export type ChannelNumber = string & {
  readonly [canonicalChannelNumber]: true;
};

export type Channel = {
  id: ChannelId;
  number: ChannelNumber;
  name: string;
  enabled: boolean;
};

/** Formats a channel the way operators read it in logs and lists. */
export function describeChannel(channel: Channel): string {
  return `${channel.number} - ${channel.name}`;
}
