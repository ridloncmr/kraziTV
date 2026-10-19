import { useState } from "react";
import { RebuildDialog } from "./rebuild-dialog.js";
import { UpcomingProgramming } from "./upcoming-programming.js";
import type { ChannelProgramming } from "../use-channel-programming.js";

/**
 * The Preview tab: the channel's upcoming programming, read again after
 * every accepted write, and **Rebuild the schedule…**.
 */
export function PreviewTab({
  channelId,
  programming,
  visible,
}: {
  channelId: string;
  programming: ChannelProgramming;
  visible: boolean;
}) {
  const [rebuilding, setRebuilding] = useState(false);
  return (
    <section aria-label="Preview">
      <UpcomingProgramming
        key={`preview-${programming.changes}`}
        path={`${programming.channelPath}/programming-preview`}
        visible={visible}
        collections={programming.collections.data}
        rules={programming.rules.data}
      />
      <button type="button" onClick={() => setRebuilding(true)}>
        Rebuild the schedule…
      </button>
      {rebuilding && (
        <RebuildDialog
          channelId={channelId}
          rebuilt={programming.changed}
          onClose={() => setRebuilding(false)}
        />
      )}
    </section>
  );
}
