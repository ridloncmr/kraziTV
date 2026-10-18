import type { PlaybackMode } from "../../http/contracts.js";

// The API shapes of specials that My Channels' specials files share.

/**
 * What a special airs, as the server saves it: media items in order, or
 * one collection block in one mode. The UI says special; the API says
 * reservation.
 */
type SpecialSource =
  | { kind: "media_items"; mediaItemIds: string[] }
  | {
      kind: "collection";
      mediaCollectionId: string;
      playbackMode: PlaybackMode;
    };
/** What a preview also takes: a collection played once from its first member. */
export type SpecialPreviewSource =
  | SpecialSource
  | {
      kind: "collection_from_beginning";
      mediaCollectionId: string;
      playbackMode: Exclude<PlaybackMode, "random">;
    };
/** A saved special on one channel. */
export interface Special {
  id: string;
  channelId: string;
  startsAt: string;
  endsAt: string;
  endKind: "explicit" | "program_derived";
  /** It cut what was airing at its start. */
  interrupts: boolean;
  source: SpecialSource;
  /**
   * Where it stands by the server's clock when listed; the browser's clock
   * never decides, since the server refuses edits and early ends by its own.
   */
  status: "upcoming" | "running" | "ended";
}
/** Why the server would refuse a previewed special, with its details. */
interface SpecialConflict {
  code: string;
  message: string;
  [detail: string]: unknown;
}
interface PreviewInterval {
  startsAt: string;
  endsAt: string;
}
/**
 * What saving a special would air. A refused one carries only its
 * revision and conflicts; one beyond the horizon displaces nothing yet.
 */
export interface SpecialPreview {
  scheduleRevision: number | null;
  conflicts: SpecialConflict[];
  startsAt?: string;
  endsAt?: string;
  endKind?: Special["endKind"];
  /** A collection from the beginning, resolved into the list to save. */
  mediaItemIds?: string[];
  beyondHorizon?: boolean;
  programs?: (PreviewInterval & {
    mediaItemId: string;
    title: string;
    estimated: boolean;
  })[];
  fillerBefore?: PreviewInterval | null;
  fillerInside?: PreviewInterval | null;
  deferredProgram?: { mediaItemId: string; title: string } | null;
  /** The ordinary program after it; none beyond the horizon. */
  resumesWith?: { mediaItemId: string; title: string; startsAt: string } | null;
}
