import { useId } from "react";
import { CheckboxOption } from "../../controls/checkbox-option/checkbox-option.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { PlaybackMode } from "../../http/contracts/programming.js";
import { MediaItemPicker } from "../../media-search/media-item-picker.js";
import { PlayOrderField } from "../members/play-order-field.js";
import type { SpecialPreviewSource } from "./contracts.js";

/** What kind of programming a special airs. */
export type SourceKind = SpecialPreviewSource["kind"];

// Each kind with the words the editor shows for it.
const KINDS: readonly { kind: SourceKind; label: string; hint: string }[] = [
  {
    kind: "media_items",
    label: "Programs I pick",
    hint: "Plays the programs you choose, in order. Leave the end blank to end with the last one.",
  },
  {
    kind: "collection_from_beginning",
    label: "A collection, from the start",
    hint: "Plays the collection once from its first program, in the play order you choose.",
  },
  {
    kind: "collection",
    label: "A collection, until a set end",
    hint: "Keeps playing the collection, continuing where the channel left off, until the end you set.",
  },
];

/**
 * The special editor's What airs fields: the kind of programming, then
 * either the programs in order, each found by search, or a collection and
 * its play order. Every change goes through its callback, which the editor
 * wraps so any edit discards its preview.
 */
export function SpecialSourceFields({
  kind,
  items,
  collectionId,
  mode,
  collections,
  visible,
  onKind,
  onItems,
  onCollection,
  onMode,
}: {
  kind: SourceKind;
  /** Chosen media item IDs in order, with "" for a row not chosen yet. */
  items: readonly string[];
  collectionId: string;
  mode: PlaybackMode;
  collections: MediaCollection[] | undefined;
  visible: boolean;
  onKind: (kind: SourceKind) => void;
  onItems: (items: string[]) => void;
  onCollection: (collectionId: string) => void;
  onMode: (mode: PlaybackMode) => void;
}) {
  const kindsId = useId();
  return (
    <>
      <div role="radiogroup" aria-labelledby={kindsId} className="field-group">
        <span id={kindsId}>What airs</span>
        {KINDS.map((choice) => (
          <CheckboxOption
            key={choice.kind}
            radio={`${kindsId}-kind`}
            label={choice.label}
            description={choice.hint}
            checked={kind === choice.kind}
            onChange={() => onKind(choice.kind)}
          />
        ))}
      </div>
      {kind === "media_items" ? (
        <ol aria-label="Special programs" className="special-programs">
          {items.map((item, index) => (
            <li key={index}>
              <div className="special-program-pick">
                <MediaItemPicker
                  label={`Program ${index + 1}`}
                  value={item}
                  visible={visible}
                  onChange={(chosen) =>
                    onItems(
                      items.map((row, at) =>
                        at === index ? (chosen?.id ?? "") : row,
                      ),
                    )
                  }
                />
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove program ${index + 1}`}
                  onClick={() => onItems(items.filter((_, at) => at !== index))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          <li>
            <button type="button" onClick={() => onItems([...items, ""])}>
              Add a program
            </button>
          </li>
        </ol>
      ) : (
        <>
          <label>
            Collection
            <select
              required
              value={collectionId}
              onChange={(event) => onCollection(event.target.value)}
            >
              <option value="">Choose a collection</option>
              {collections?.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
          <PlayOrderField
            mode={mode}
            hint
            random={kind === "collection"}
            onChange={onMode}
          />
        </>
      )}
    </>
  );
}
