import type { Channel, ChannelNumber } from "@krazitv/krazi-brain";

/** A persisted channel: kraziBrain's identity plus its storage timestamps. */
export type StoredChannel = Channel & {
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

export interface ChannelRepositoryOptions {
  createId?: () => string;
  now?: () => number;
}
