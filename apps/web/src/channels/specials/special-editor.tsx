import { useEffect, useRef, useState } from "react";

import { fromLocalInput, toLocalInput } from "../../controls/local-instant.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { PlaybackMode } from "../../http/contracts/programming.js";
import { useMutation } from "../../http/use-resource.js";
import { MediaItemPicker } from "../../media-search/media-item-picker.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import type {
  Special,
  SpecialPreview as Preview,
  SpecialPreviewSource,
} from "./contracts.js";
import { SpecialPreview } from "./special-preview.js";

type SourceKind = SpecialPreviewSource["kind"];

/** The settings one preview was made from, saved exactly as previewed. */
type PreviewedSettings = {
  startsAt: string | undefined;
  endsAt: string | null;
  interrupts: boolean;
  source: SpecialPreviewSource;
};

/**
 * Builds or edits one special: a start (the server refuses one more than a
 * year ahead, as a preview conflict), an optional end,
 * and what airs, as media items in order, a collection block, or a
 * collection from the beginning. A save sends exactly the settings its
 * preview was made from, with that preview's programming revision, so the
 * guide changes only to what the owner saw; any edit discards the preview,
 * and a preview that answers after an edit is dropped. Each preview gets a
 * fresh request key, so resending a save finds what it created but a save
 * of new settings never returns an earlier one. A save the server finds
 * stale asks for a fresh preview instead of resending. When the start falls
 * before what airs now ends, it asks What is airing now, as the Rebuild the
 * schedule dialog does: let it finish, starting when it ends, or stop it at
 * the special's start, now or later (ADR 0015).
 */
export function SpecialEditor({
  channelId,
  special,
  collections,
  visible,
  saved,
  onClose,
}: {
  channelId: string;
  special?: Special;
  collections: MediaCollection[] | undefined;
  visible: boolean;
  saved: () => void;
  onClose: () => void;
}) {
  const path = `${resourcePath("channels", channelId)}/reservations`;
  const source = special?.source;
  const [startsAt, setStartsAt] = useState(
    special ? toLocalInput(special.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    special?.endKind === "explicit" ? toLocalInput(special.endsAt) : "",
  );
  // Until the owner changes a time, the stored instant is sent unchanged, so
  // an edit never moves it by the input's minute or a repeated DST hour.
  const [startTouched, setStartTouched] = useState(false);
  // What the What is airing now choice set: an exact start ("now", or when
  // the airing item ends) and whether the special cuts what airs.
  const [exactStart, setExactStart] = useState<string>();
  const [interrupts, setInterrupts] = useState(special?.interrupts ?? false);
  // When what airs now ends, once a preview found the start crossing it.
  const [airingEndsAt, setAiringEndsAt] = useState<string>();
  const [endTouched, setEndTouched] = useState(false);
  const [kind, setKind] = useState<SourceKind>(source?.kind ?? "media_items");
  const [items, setItems] = useState<string[]>(
    source?.kind === "media_items" ? source.mediaItemIds : [""],
  );
  const [collectionId, setCollectionId] = useState(
    source?.kind === "collection" ? source.mediaCollectionId : "",
  );
  const [mode, setMode] = useState<PlaybackMode>(
    source?.kind === "collection" ? source.playbackMode : "chronological",
  );
  const [previewed, setPreviewed] = useState<{
    settings: PreviewedSettings;
    result: Preview;
    requestKey: string;
  }>();
  const [stale, setStale] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Counts edits, so a preview that answers after one is dropped.
  const edits = useRef(0);
  const previewing = useMutation();
  const saving = useMutation();

  // A failed save is shown until a newer preview; a stale one also
  // discards the preview it was made from.
  useEffect(() => {
    if (saving.error === undefined) return;
    setSaveFailed(true);
    if (
      saving.error instanceof ApiError &&
      saving.error.code === "preview_stale"
    ) {
      setPreviewed(undefined);
      setStale(true);
    }
  }, [saving.error]);

  // Every edit discards the preview, so a save never outlives what it showed.
  const edit = (change: () => void) => {
    edits.current += 1;
    change();
    setPreviewed(undefined);
  };
  const ordered = kind === "collection_from_beginning";

  // Reads the form, with any What is airing now choice in `choice`, as the
  // settings a preview is asked about.
  const settings = (
    choice: { exactStart?: string; interrupts?: boolean } = {},
  ): PreviewedSettings => ({
    startsAt:
      choice.exactStart ??
      exactStart ??
      (special && !startTouched ? special.startsAt : fromLocalInput(startsAt)),
    endsAt:
      special?.endKind === "explicit" && !endTouched
        ? special.endsAt
        : (fromLocalInput(endsAt) ?? null),
    interrupts: choice.interrupts ?? interrupts,
    source:
      kind === "media_items"
        ? { kind, mediaItemIds: items.filter((item) => item !== "") }
        : kind === "collection"
          ? { kind, mediaCollectionId: collectionId, playbackMode: mode }
          : {
              kind,
              mediaCollectionId: collectionId,
              playbackMode: mode === "random" ? "chronological" : mode,
            },
  });

  // Asks the server what saving the current settings would air, with any
  // choice just made; a start that crosses what airs offers the choice.
  const requestPreview = (
    choice: { exactStart?: string; interrupts?: boolean } = {},
  ) => {
    const asked = settings(choice);
    const at = edits.current;
    setStale(false);
    setSaveFailed(false);
    void previewing.run<Preview>(
      `${path}/preview`,
      "POST",
      special ? { ...asked, replacesReservationId: special.id } : asked,
      (result) => {
        if (edits.current !== at) return;
        const crossing = result.conflicts.find(
          (conflict) => conflict.code === "reservation_crosses_airing",
        );
        if (typeof crossing?.airingEndsAt === "string") {
          setAiringEndsAt(crossing.airingEndsAt);
        }
        setPreviewed({
          settings: asked,
          result,
          requestKey: crypto.randomUUID(),
        });
      },
    );
  };
  // Saves exactly what was previewed; a collection from the beginning saves
  // as the list it resolved to.
  const save = () => {
    if (!previewed) return;
    const { settings: asked, result, requestKey } = previewed;
    const saveSource =
      asked.source.kind === "collection_from_beginning"
        ? { kind: "media_items", mediaItemIds: result.mediaItemIds ?? [] }
        : asked.source;
    const guards = special
      ? { expectedProgrammingRevision: result.programmingRevision }
      : {
          expectedProgrammingRevision: result.programmingRevision,
          requestKey,
        };
    void saving.run(
      special ? `${path}/${special.id}` : path,
      special ? "PATCH" : "POST",
      { ...asked, source: saveSource, ...guards },
      saved,
    );
  };

  const incomplete =
    startsAt === "" ||
    (kind !== "media_items" && collectionId === "") ||
    (kind === "collection" && endsAt === "");
  return (
    <fieldset disabled={saving.pending}>
      <legend>{special ? "Edit special" : "New special"}</legend>
      <div className="inline-form">
        <label>
          Starts
          <input
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) =>
              edit(() => {
                setStartsAt(event.target.value);
                setStartTouched(true);
                // A new start asks the What is airing now question afresh.
                setExactStart(undefined);
                setInterrupts(false);
                setAiringEndsAt(undefined);
              })
            }
          />
        </label>
        <label>
          {kind === "collection" ? "Ends" : "Ends (optional)"}
          <input
            type="datetime-local"
            required={kind === "collection"}
            value={endsAt}
            onChange={(event) =>
              edit(() => {
                setEndsAt(event.target.value);
                setEndTouched(true);
              })
            }
          />
        </label>
        <label>
          What airs
          <select
            value={kind}
            onChange={(event) =>
              edit(() => setKind(event.target.value as SourceKind))
            }
          >
            <option value="media_items">Media items in order</option>
            <option value="collection">A collection block</option>
            <option value="collection_from_beginning">
              A collection from the beginning
            </option>
          </select>
        </label>
      </div>
      {kind === "media_items" ? (
        <ol aria-label="Special media items">
          {items.map((item, index) => (
            <li key={index} className="inline-form">
              <MediaItemPicker
                label={`Program ${index + 1}`}
                value={item}
                visible={visible}
                onChange={(chosen) =>
                  edit(() =>
                    setItems((rows) =>
                      rows.map((row, at) =>
                        at === index ? (chosen?.id ?? "") : row,
                      ),
                    ),
                  )
                }
              />
              {items.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove program ${index + 1}`}
                  onClick={() =>
                    edit(() =>
                      setItems((rows) => rows.filter((_, at) => at !== index)),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => edit(() => setItems((rows) => [...rows, ""]))}
            >
              Add a program
            </button>
          </li>
        </ol>
      ) : (
        <div className="inline-form">
          <label>
            Collection
            <select
              required
              value={collectionId}
              onChange={(event) =>
                edit(() => setCollectionId(event.target.value))
              }
            >
              <option value="">Choose a collection</option>
              {collections?.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Playback mode
            <select
              value={mode}
              onChange={(event) =>
                edit(() => setMode(event.target.value as PlaybackMode))
              }
            >
              {PLAYBACK_MODE_CHOICES.filter(
                (choice) => !ordered || choice.mode !== "random",
              ).map((choice) => (
                <option key={choice.mode} value={choice.mode}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {stale && (
        <p role="alert">
          The schedule changed since this preview. Preview again before saving.
        </p>
      )}
      {airingEndsAt && (
        <fieldset>
          <legend>What is airing now</legend>
          <label>
            <input
              type="radio"
              name="airing-choice"
              checked={!interrupts && exactStart === airingEndsAt}
              onChange={() => {
                setInterrupts(false);
                setExactStart(airingEndsAt);
                setStartsAt(toLocalInput(airingEndsAt));
                requestPreview({ exactStart: airingEndsAt, interrupts: false });
              }}
            />
            Let it finish
          </label>
          <label>
            <input
              type="radio"
              name="airing-choice"
              checked={interrupts && exactStart !== "now"}
              onChange={() => {
                setInterrupts(true);
                requestPreview({ interrupts: true });
              }}
            />
            Stop it at the special's start
          </label>
          <p>
            {interrupts
              ? "What is airing is cut at the special's start. Viewers stay tuned and see it cut straight into the special."
              : "Let it finish to start the special when what is airing ends, or stop it at the special's start."}
          </p>
          <button
            type="button"
            onClick={() => {
              setInterrupts(true);
              setExactStart("now");
              requestPreview({ exactStart: "now", interrupts: true });
            }}
          >
            Start now
          </button>
        </fieldset>
      )}
      {previewed && <SpecialPreview preview={previewed.result} />}
      <RequestFeedback
        loading={previewing.pending || saving.pending}
        error={
          previewing.error ?? (saveFailed && !stale ? saving.error : undefined)
        }
      />
      <div className="row-actions">
        <button
          type="button"
          disabled={previewing.pending || incomplete}
          onClick={() => requestPreview()}
        >
          Preview
        </button>
        <button
          type="button"
          disabled={
            previewed === undefined ||
            previewed.result.conflicts.length > 0 ||
            saving.pending
          }
          onClick={save}
        >
          Save special
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </fieldset>
  );
}
