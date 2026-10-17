import type { ChannelStreamManagerContract } from "@krazitv/signal";

import type { ChannelNumber } from "./channel-number.js";

/** A persisted channel: its lineup identity plus storage timestamps. */
export type StoredChannel = {
  id: string;
  number: ChannelNumber;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export interface CreateChannelInput {
  number: ChannelNumber;
  name: string;
  enabled: boolean;
}

/** Fields a partial update may change; absent fields keep their stored value. */
export type ChannelChanges = Partial<CreateChannelInput>;

/** Names the contested number so callers can report it without re-reading input. */
type DuplicateNumberResult = {
  kind: "duplicate_number";
  number: ChannelNumber;
};

export type CreateChannelResult =
  { kind: "created"; channel: StoredChannel } | DuplicateNumberResult;

export type UpdateChannelResult =
  | { kind: "updated"; channel: StoredChannel }
  | { kind: "not_found" }
  | DuplicateNumberResult;

/**
 * The slice of the channel stream manager administrative routes need: an
 * administrative stop that settles a channel's runtime after disable or
 * delete, and the notice that a committed schedule write may have cut what
 * airs (ADR 0015).
 */
export type ChannelRuntime = Pick<
  ChannelStreamManagerContract,
  "stopChannel" | "scheduleChanged"
>;

/**
 * The slice of the channel stream manager the server owns: one viewer's tune,
 * and the shutdown that ends live streams so the server can close.
 */
export type ChannelStreams = Pick<
  ChannelStreamManagerContract,
  "subscribe" | "shutdown"
>;
