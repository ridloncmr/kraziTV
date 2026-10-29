import type { KeyboardEvent, ReactNode } from "react";

/**
 * XP property-sheet tabs over one panel, as the WAI-ARIA tabs pattern
 * describes. The caller owns the chosen tab, so a program can keep it while
 * its window stays open, and renders only the chosen tab's content.
 */
export function TabbedPanel<T extends string>({
  label,
  idPrefix,
  tabs,
  selected,
  onSelect,
  children,
}: {
  /** Names the tab list for assistive technology. */
  label: string;
  /** Keeps tab and panel IDs unique among the desktop's open windows. */
  idPrefix: string;
  tabs: readonly { key: T; label: string }[];
  selected: T;
  onSelect: (tab: T) => void;
  children: ReactNode;
}) {
  const tabId = (key: T) => `${idPrefix}-tab-${key}`;
  const panelId = (key: T) => `${idPrefix}-panel-${key}`;

  /** Arrow keys move between tabs and focus the new one, as the pattern expects. */
  function switchByKey(event: KeyboardEvent) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const index = tabs.findIndex((tab) => tab.key === selected);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    onSelect(next.key);
    document.getElementById(tabId(next.key))?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        className="tab-strip"
        onKeyDown={switchByKey}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={tabId(tab.key)}
            aria-selected={tab.key === selected}
            aria-controls={panelId(tab.key)}
            tabIndex={tab.key === selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId(selected)}
        aria-labelledby={tabId(selected)}
        className="tab-panel"
      >
        {children}
      </div>
    </>
  );
}
