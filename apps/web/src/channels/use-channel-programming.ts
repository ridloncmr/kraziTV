import { useState } from "react";
import { resourcePath } from "../http/api-client.js";
import type { ChannelState } from "../http/contracts/channels.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../http/contracts/programming.js";
import type { StretchSuggestion } from "../http/contracts/programming.js";
import { useResource, useResourceMap } from "../http/resources/use-resource.js";
import type { ContentKind } from "./contracts.js";
import { suggestionPath } from "./lineup/show-draft.js";

// The rebuild question needs only a recent answer, so a minute matches My
// Channels' now line; a stale read hides the offer and never interrupts.
const AIRING_POLL_MS = 60_000;

/**
 * Reads what a channel's Lineup, Rules, and Preview tabs share: its
 * assignments in saved order, the collections they name, its rules, each
 * assignment's content kind, which words its per-sitting presets, and the
 * program airing now, which decides whether a write offers the rebuild
 * question. `changed` refreshes what any accepted programming write can
 * change and counts the writes, so the preview reads again after each.
 */
export function useChannelProgramming(channelId: string, visible: boolean) {
  const channelPath = resourcePath("channels", channelId);
  const assignmentsPath = `${channelPath}/programming-assignments`;
  const assignments = useResource<SourceAssignment[]>(assignmentsPath, visible);
  const now = useResource<ChannelState>(
    `${channelPath}/now`,
    visible,
    AIRING_POLL_MS,
  );
  // The airing program's title; nothing while filler or nothing airs, or
  // until the first read lands, so a write then applies silently.
  const airingProgram =
    now.data?.currentItem?.type === "program"
      ? now.data.currentItem.title
      : undefined;
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const rules = useResource<ProgrammingRule[]>(
    `${channelPath}/programming-rules`,
    visible,
  );
  const suggestions = useResourceMap<StretchSuggestion>(
    (assignments.data ?? []).map((assignment) =>
      suggestionPath(assignment.members),
    ),
    visible,
  );
  // Unknown until read, and then worded as programs, like mixed content.
  const contentKind = (assignment: SourceAssignment): ContentKind =>
    suggestions.get(suggestionPath(assignment.members))?.contentKind ?? null;
  const [changes, setChanges] = useState(0);
  // Refreshes what every write can change: the lineup, rules, preview, and
  // what airs, since a fresh rebuild replaces the airing program.
  const changed = () => {
    setChanges((count) => count + 1);
    assignments.refresh();
    rules.refresh();
    now.refresh();
  };
  return {
    channelPath,
    assignmentsPath,
    assignments,
    collections,
    rules,
    contentKind,
    airingProgram,
    changes,
    changed,
  };
}

/** What `useChannelProgramming` reads, handed to each programming tab. */
export type ChannelProgramming = ReturnType<typeof useChannelProgramming>;
