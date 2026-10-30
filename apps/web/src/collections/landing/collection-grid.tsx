import { TabbedPanel } from "../../controls/tabbed-panel/tabbed-panel.js";
import type {
  MediaCollection,
  MediaCollectionSummary,
} from "../../http/contracts/collections.js";
import {
  CardMaintenanceStatus,
  criterionBasis,
} from "../automatic/automatic-status.js";
import { missingWords } from "../collection-words.js";
import { CollectionTypeSelect } from "../../collection-types/collection-type-select.js";
import {
  type CollectionType,
  hasCollectionType,
} from "../../collection-types/collection-type.js";

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
 * collections. The Automatic tab narrows its grid by collection type, such
 * as TV series or Tag. The parent owns the chosen tab and type, so a
 * created collection's card is shown when it opens.
 */
export function CollectionGrid({
  collections,
  tab,
  onTabChange,
  type,
  onTypeChange,
  onOpen,
  onCreate,
  onDiscover,
}: {
  collections: readonly MediaCollectionSummary[];
  tab: MaintenanceMode;
  onTabChange: (tab: MaintenanceMode) => void;
  /** The Automatic tab's type filter; null shows every type. */
  type: CollectionType | null;
  onTypeChange: (type: CollectionType | null) => void;
  /** Opens a collection in its own window. */
  onOpen: (collection: MediaCollectionSummary) => void;
  /** Opens the creation dialog for the shown tab's kind of collection. */
  onCreate: (mode: MaintenanceMode) => void;
  /** Opens the recommendations; offered on the Automatic tab. */
  onDiscover: () => void;
}) {
  const inTab = collections.filter(
    (collection) => collection.maintenanceMode === tab,
  );
  const filtered = tab === "automatic" && type !== null;
  const shown = filtered
    ? inTab.filter((collection) => hasCollectionType(collection, type))
    : inTab;

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
      {tab === "automatic" && (
        <div className="inline-form">
          <CollectionTypeSelect
            collections={inTab}
            value={type}
            onChange={onTypeChange}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="empty-state">
          {filtered && inTab.length > 0
            ? "No automatic collections of this type. Choose All types to see every one."
            : EMPTY_TEXT[tab]}
        </p>
      ) : (
        <ul className="collection-grid">
          {shown.map((collection) => (
            <li key={collection.id}>
              <button
                className="collection-card"
                aria-label={`Open ${collection.name}`}
                aria-describedby={countId(collection.id)}
                onClick={() => onOpen(collection)}
              >
                <strong>{collection.name}</strong>
                <span className="secondary" id={countId(collection.id)}>
                  {criterionBasis(collection) !== null && (
                    <span>{criterionBasis(collection)}</span>
                  )}
                  {/* Count and status share a line, keeping every card short. */}
                  <span className="card-line">
                    <span>
                      {collection.memberCount}{" "}
                      {collection.memberCount === 1 ? "item" : "items"}
                    </span>
                    {collection.maintenanceMode === "automatic" && (
                      <CardMaintenanceStatus collection={collection} />
                    )}
                  </span>
                  {collection.missingCount > 0 && (
                    <span
                      className="warning-label"
                      title={missingWords(collection.missingCount)}
                    >
                      {missingWords(collection.missingCount)}
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

// Names a card's member count so the card announces it beside its name.
function countId(collectionId: string) {
  return `collection-count-${collectionId}`;
}
