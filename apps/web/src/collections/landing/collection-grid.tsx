import { TabbedPanel } from "../../controls/tabbed-panel.js";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../../http/contracts/collections.js";
import {
  CardMaintenanceStatus,
  criterionBasis,
} from "../automatic/automatic-status.js";

type MaintenanceMode = MediaCollection["maintenanceMode"];

const TABS: readonly { key: MaintenanceMode; label: string }[] = [
  { key: "manual", label: "Manual" },
  { key: "automatic", label: "Automatic" },
];

const CREATE_LABEL: Record<MaintenanceMode, string> = {
  manual: "New collection…",
  automatic: "New automatic collection…",
};

const EMPTY_TEXT: Record<MaintenanceMode, string> = {
  manual:
    "No manual collections yet. Create one, then add media from the catalog.",
  automatic:
    "No automatic collections yet. Automatic collections keep their members up to date as your catalog changes.",
};

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
  onDiscover,
}: {
  collections: readonly MediaCollectionSummary[];
  tab: MaintenanceMode;
  onTabChange: (tab: MaintenanceMode) => void;
  onOpen: (id: string) => void;
  /** Opens the creation dialog for the shown tab's kind of collection. */
  onCreate: (mode: MaintenanceMode) => void;
  /** Opens the recommendations; offered on the Automatic tab. */
  onDiscover: () => void;
}) {
  const shown = collections.filter(
    (collection) => collection.maintenanceMode === tab,
  );

  return (
    <TabbedPanel
      label="Collection kinds"
      idPrefix="collections"
      tabs={TABS}
      selected={tab}
      onSelect={onTabChange}
    >
      <div className="row-actions">
        <button onClick={() => onCreate(tab)}>{CREATE_LABEL[tab]}</button>
        {tab === "automatic" && (
          <button onClick={onDiscover}>Discover collections…</button>
        )}
      </div>
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
                  {criterionBasis(collection) !== null && (
                    <span>{criterionBasis(collection)}</span>
                  )}
                  <span>
                    {collection.memberCount}{" "}
                    {collection.memberCount === 1 ? "item" : "items"}
                  </span>
                  {collection.maintenanceMode === "automatic" && (
                    <CardMaintenanceStatus collection={collection} />
                  )}
                  {collection.missingCount > 0 && (
                    <span className="warning-label">
                      {missingText(collection.missingCount)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </TabbedPanel>
  );
}

// Counts missing members as not airing, in words, so the warning never relies on color.
function missingText(count: number): string {
  return count === 1
    ? "1 missing — won't air until its file returns"
    : `${count} missing — won't air until their files return`;
}

// Names a card's member count so the card announces it beside its name.
function countId(collectionId: string) {
  return `collection-count-${collectionId}`;
}
