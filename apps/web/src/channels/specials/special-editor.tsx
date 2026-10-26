import { useEffect, useId, useRef, useState } from "react";
import { fromLocalInput, toLocalInput } from "../../controls/local-instant.js";
import { CheckboxOption } from "../../controls/checkbox-option.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import { ApiError } from "../../http/api-error.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type { PlaybackMode } from "../../http/contracts/programming.js";
import { useMutation } from "../../http/resources/use-resource.js";
import type {
  Special,
  SpecialPreview as Preview,
  SpecialPreviewSource,
} from "./contracts.js";
import { SpecialPreview } from "./special-preview.js";
import {
  type SourceKind,
  SpecialSourceFields,
} from "./special-source-fields.js";

/** The settings one preview was made from, saved exactly as previewed. */
type PreviewedSettings = {
  startsAt: string | undefined;
  endsAt: string | null;
  interrupts: boolean;
  source: SpecialPreviewSource;
};

/**
 * Builds or edits one special in a window dialog: a start (the server
 * refuses one more than a year ahead, as a preview conflict), an optional
 * end, and what airs, as media items in order, a collection block, or a
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
  const airingId = useId();

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
      special ? `${path}/${encodeURIComponent(special.id)}` : path,
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
    <WindowDialog
      title={special ? "Edit special" : "New special"}
      busy={saving.pending}
      onClose={onClose}
    >
      <fieldset disabled={saving.pending} className="form-stack">
        <div className="field-pair">
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
        </div>
        <SpecialSourceFields
          kind={kind}
          items={items}
          collectionId={collectionId}
          mode={mode}
          collections={collections}
          visible={visible}
          onKind={(next) =>
            edit(() => {
              setKind(next);
              // A collection from the start plays once, so never at random.
              if (next === "collection_from_beginning" && mode === "random") {
                setMode("chronological");
              }
            })
          }
          onItems={(next) => edit(() => setItems(next))}
          onCollection={(next) => edit(() => setCollectionId(next))}
          onMode={(next) => edit(() => setMode(next))}
        />
        {airingEndsAt && (
          <div
            role="radiogroup"
            aria-labelledby={airingId}
            className="field-group inline-notice"
          >
            <strong id={airingId}>What is airing now</strong>
            <span className="secondary">
              This special starts before what is airing ends.
            </span>
            <CheckboxOption
              radio={`${airingId}-choice`}
              label="Let it finish"
              description="The special starts when it ends."
              checked={!interrupts && exactStart === airingEndsAt}
              onChange={() => {
                setInterrupts(false);
                setExactStart(airingEndsAt);
                setStartsAt(toLocalInput(airingEndsAt));
                requestPreview({
                  exactStart: airingEndsAt,
                  interrupts: false,
                });
              }}
            />
            <CheckboxOption
              radio={`${airingId}-choice`}
              label="Stop it at the special's start"
              description="Viewers stay tuned and see it cut straight into the special."
              checked={interrupts && exactStart !== "now"}
              onChange={() => {
                setInterrupts(true);
                requestPreview({ interrupts: true });
              }}
            />
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
          </div>
        )}
      </fieldset>
      {stale && (
        <p role="alert">
          The schedule changed since this preview. Preview again before saving.
        </p>
      )}
      {previewed && <SpecialPreview preview={previewed.result} />}
      <RequestFeedback
        loading={previewing.pending || saving.pending}
        error={
          previewing.error ?? (saveFailed && !stale ? saving.error : undefined)
        }
      />
      {!previewed && (
        <p className="secondary">
          Preview the special to see what it airs and what it moves, then save
          it.
        </p>
      )}
      <div className="dialog-actions">
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
        <button type="button" disabled={saving.pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </WindowDialog>
  );
}
