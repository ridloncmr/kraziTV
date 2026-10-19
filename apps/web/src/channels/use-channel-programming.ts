import { useState } from "react";
import { resourcePath } from "../http/api-client.js";
import type { MediaCollection } from "../http/contracts/collections.js";
import type {
  ProgrammingRule,
  SourceAssignment,
} from "../http/contracts/programming.js";
import { useResource } from "../http/use-resource.js";

/**
 * Reads what a channel's Lineup, Rules, and Preview tabs share: its
 * assignments in saved order, the collections they name, and its rules.
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
    changes,
    changed,
  };
}

/** What `useChannelProgramming` reads, handed to each programming tab. */
export type ChannelProgramming = ReturnType<typeof useChannelProgramming>;
