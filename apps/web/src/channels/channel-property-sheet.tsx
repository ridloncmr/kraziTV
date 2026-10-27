import { useEffect } from "react";
import { TabbedPanel } from "../controls/tabbed-panel.js";
import type { Channel } from "../http/contracts/channels.js";
import { GeneralTab } from "./identity/general-tab.js";
import { LineupTab } from "./lineup/lineup-tab.js";
import { PreviewTab } from "./preview/preview-tab.js";
import { useChannelProgramming } from "./use-channel-programming.js";
import { RulesEditor } from "./rules/rules-editor.js";
import { SpecialsSection } from "./specials/specials-section.js";

/** One tab of a channel's property sheet. */
export type ChannelTab =
  "general" | "lineup" | "rules" | "specials" | "preview";

const TABS: readonly { key: ChannelTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "lineup", label: "Lineup" },
  { key: "rules", label: "Rules" },
  { key: "specials", label: "Specials" },
  { key: "preview", label: "Preview" },
];

// Rules and Preview explain programming the channel does not have until
// its lineup holds a show.
const NEEDS_A_SHOW: ReadonlySet<ChannelTab> = new Set(["rules", "preview"]);

/**
 * The selected channel as an XP property sheet: General, Lineup, Rules,
 * Specials, and Preview tabs. The window owns the chosen tab, so it stays
 * while the program is open; a channel whose lineup is empty opens on
 * Lineup. Tab state is desktop shell state and never affects broadcast.
 */
export function ChannelPropertySheet({
  channel,
  visible,
  tab,
  onTabChange,
  changed,
}: {
  channel: Channel;
  visible: boolean;
  tab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  /** Refreshes the channel list after an identity change. */
  changed: () => void;
}) {
  const programming = useChannelProgramming(channel.id, visible);
  const lineup = programming.assignments.data;
  // Until the lineup is read, every tab stays, so a remembered Rules or
  // Preview tab is not swapped for Lineup while the channel loads.
  const hasShow = lineup === undefined || lineup.length > 0;
  const tabs = TABS.filter((item) => hasShow || !NEEDS_A_SHOW.has(item.key));
  // A tab the lineup hides, such as Rules after its last show is removed,
  // shows Lineup until a show returns.
  const shown = tabs.some((item) => item.key === tab) ? tab : "lineup";
  // A channel with nothing to play goes straight to its lineup, when it
  // opens (the sheet remounts per channel) or its last show is removed.
  const empty = lineup?.length === 0;
  useEffect(() => {
    if (empty) onTabChange("lineup");
  }, [empty, onTabChange]);
  return (
    <section aria-label={`${channel.number} · ${channel.name} properties`}>
      <h3>
        {channel.number} · {channel.name}
      </h3>
      <TabbedPanel
        label="Channel properties"
        idPrefix={`channel-${channel.id}`}
        tabs={tabs}
        selected={shown}
        onSelect={onTabChange}
      >
        {shown === "general" && (
          <GeneralTab channel={channel} changed={changed} />
        )}
        {shown === "lineup" && (
          <LineupTab
            channelId={channel.id}
            programming={programming}
            visible={visible}
          />
        )}
        {shown === "rules" && lineup && (
          <RulesEditor
            channelId={channel.id}
            visible={visible}
            programming={programming}
          />
        )}
        {shown === "specials" && (
          <SpecialsSection channelId={channel.id} visible={visible} />
        )}
        {shown === "preview" && (
          <PreviewTab
            channelId={channel.id}
            programming={programming}
            visible={visible}
          />
        )}
      </TabbedPanel>
    </section>
  );
}
