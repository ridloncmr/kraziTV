export type SignalPlayoutItem = {
  playoutItemId: string;
  mediaItemId: string;
  mediaPath: string;
  offsetMs: number;
  durationMs: number;
};

export type PackageStreamRequest = {
  channelId: string;
  initialPlayoutItemId: string;
  items: SignalPlayoutItem[];
  contentType: "video/MP2T";
};
