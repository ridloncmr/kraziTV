import type { KeyboardEvent } from "react";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../../http/contracts.js";

type MaintenanceMode = MediaCollection["maintenanceMode"];

const TABS: readonly { mode: MaintenanceMode; label: string }[] = [
  { mode: "manual", label: "Manual" },
  { mode: "automatic", label: "Automatic" },
];

/**
 * The Collections landing: Manual and Automatic tabs, each a grid of created
 * collections. The parent owns the chosen tab, so returning from an editor
 * lands on the tab the owner left.
 */
export function CollectionGrid({
  collections,
  tab,
  onTabChange,
  onOpen,
  onCreate,
}: {
  collections: readonly MediaCollectionSummary[];
  tab: MaintenanceMode;
  onTabChange: (tab: MaintenanceMode) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const shown = collections.filter(
    (collection) => collection.maintenanceMode === tab,
  );

  /** Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects. */
  function switchByKey(event: KeyboardEvent) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const index = TABS.findIndex((item) => item.mode === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next === undefined) return;
    onTabChange(next.mode);
    document.getElementById(tabId(next.mode))?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Collection kinds"
        className="tab-strip"
        onKeyDown={switchByKey}
      >
        {TABS.map((item) => (
          <button
            key={item.mode}
            role="tab"
            id={tabId(item.mode)}
            aria-selected={item.mode === tab}
            aria-controls={panelId(item.mode)}
            tabIndex={item.mode === tab ? 0 : -1}
            onClick={() => onTabChange(item.mode)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        className="tab-panel"
      >
        {tab === "manual" && (
          <div className="row-actions">
            <button onClick={onCreate}>New collection…</button>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="empty-state">{EMPTY_TEXT[tab]}</p>
        ) : (
          <ul className="collection-grid">
            {shown.map((collection) => (
              <li key={collection.id}>
                <button
                  className="collection-card"
                  aria-label={`Open ${collection.name}`}
                  aria-describedby={countId(collection.id)}
                  onClick={() => onOpen(collection.id)}
                >
                  <strong>{collection.name}</strong>
                  <span className="secondary" id={countId(collection.id)}>
                    {collection.memberCount}{" "}
                    {collection.memberCount === 1 ? "item" : "items"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

const EMPTY_TEXT: Record<MaintenanceMode, string> = {
  manual:
    "No manual collections yet. Create one, then add media from the catalog.",
  automatic:
    "No automatic collections yet. Automatic collections keep their members up to date as your catalog changes.",
};

// Names a tab so its panel can point back to it with aria-labelledby.
function tabId(mode: MaintenanceMode) {
  return `collections-tab-${mode}`;
}

// Names a card's member count so the card announces it beside its name.
function countId(collectionId: string) {
  return `collection-count-${collectionId}`;
}

// Names a panel so its tab can point to it with aria-controls.
function panelId(mode: MaintenanceMode) {
  return `collections-panel-${mode}`;
}
