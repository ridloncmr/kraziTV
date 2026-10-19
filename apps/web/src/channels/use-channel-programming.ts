import { useState } from "react";
import { resourcePath } from "../http/api-client.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../http/contracts/programming.js";
import type { StretchSuggestion } from "../http/contracts/programming.js";
import { useResource, useResourceMap } from "../http/use-resource.js";
import type { ContentKind } from "./contracts.js";
import { suggestionPath } from "./lineup/show-draft.js";

/**
 * Reads what a channel's Lineup, Rules, and Preview tabs share: its
 * assignments in saved order, the collections they name, its rules, and
 * each assignment's content kind, which words its per-sitting presets.
 * `changed` refreshes what any accepted programming write can change and
 * counts the writes, so the preview reads again after each.
 */
export function useChannelProgramming(channelId: string, visible: boolean) {
  const channelPath = resourcePath("channels", channelId);
  const assignmentsPath = `${channelPath}/programming-assignments`;
  const assignments = useResource<SourceAssignment[]>(assignmentsPath, visible);
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
  // Refreshes what every write can change: the lineup, rules, and preview.
  const changed = () => {
    setChanges((count) => count + 1);
    assignments.refresh();
    rules.refresh();
  };
  return {
    channelPath,
    assignmentsPath,
    assignments,
    collections,
    rules,
    contentKind,
    changes,
    changed,
  };
}

/** What `useChannelProgramming` reads, handed to each programming tab. */
export type ChannelProgramming = ReturnType<typeof useChannelProgramming>;
