import { useEffect, useId, useRef, useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import type {
  AssignmentSettings,
  CollectionPreview,
  PlaybackMode,
  SourceAssignment,
  StretchSuggestion,
} from "../../http/contracts/programming.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { type MemberDraft, MemberRows, NEW_MEMBER } from "./member-rows.js";
import { ProgrammingPreview } from "./programming-preview.js";
import { ProgressResetDialog } from "./progress-reset-dialog.js";
import {
  type StretchDraft,
  StretchFields,
  suggestMarathon,
  toStretchDraft,
  toStretchSetting,
  UNCHOSEN_STRETCH,
} from "./stretch-fields.js";
import { PLAYBACK_MODE_CHOICES } from "./playback-mode-choices.js";

/**
 * Edits one programming source assignment, or adds one when none is given:
 * members in saved order, each a collection or a single item, with the
 * playback mode and turn length its collections play by. Each turn goes to
 * the next member, and a single item airs once a turn. A new assignment
 * takes the server's suggested turn length until the owner sets one, and
 * asks when there is no suggestion. It previews and restarts one saved
 * collection at a time; `changed` runs after every write the server
 * accepted.
 */
export function AssignmentForm({
  assignmentsPath,
  assignment,
  legend,
  collections,
  visible,
  changed,
}: {
  assignmentsPath: string;
  assignment?: SourceAssignment | undefined;
  legend: string;
  collections: MediaCollection[] | undefined;
  visible: boolean;
  changed: () => void;
}) {
  const mutation = useMutation();
  const hintId = useId();
  const [members, setMembers] = useState<MemberDraft[]>([NEW_MEMBER]);
  const [mode, setMode] = useState<PlaybackMode>("chronological");
  const [stretch, setStretch] = useState<StretchDraft>(UNCHOSEN_STRETCH);
  // Whether the owner set the turn length, so a suggestion never overrides it.
  const [stretchSet, setStretchSet] = useState(false);
  // Off for a rule-only assignment, which airs only when a rule selects it.
  const [rotates, setRotates] = useState(true);
  // Null while marathons are off for this assignment.
  const [marathon, setMarathon] = useState<StretchDraft | null>(null);
  const [previewed, setPreviewed] = useState("");
  const dirty = useRef(false);
  const assignmentPath = assignment
    ? `${assignmentsPath}/${encodeURIComponent(assignment.id)}`
    : undefined;
  // The saved collections and the mode the assignment plays them in.
  const savedCollections = (assignment?.members ?? []).flatMap((member) =>
    member.kind === "collection" ? [member.mediaCollectionId] : [],
  );
  const savedMode = assignment?.playbackMode ?? null;
  const previewedId = savedCollections.includes(previewed)
    ? previewed
    : savedCollections[0];
  const hasCollection = members.some((member) => member.kind === "collection");
  // A new assignment asks for a suggested turn length once its members are chosen.
  const suggestion = useResource<StretchSuggestion>(
    assignment === undefined &&
      !stretchSet &&
      hasCollection &&
      members.every((member) => member.sourceId)
      ? suggestionPath(members)
      : null,
    visible,
  );
  const suggested = suggestion.data?.ordinaryStretch;
  useEffect(() => {
    if (suggested !== undefined && !stretchSet) {
      const next =
        suggested === null ? UNCHOSEN_STRETCH : toStretchDraft(suggested);
      setStretch(next);
      // A marathon allowed already follows, so it stays longer than the turn.
      setMarathon((current) =>
        current === null ? null : suggestMarathon(next),
      );
    }
  }, [suggested, stretchSet]);
  // The server previews saved collections only, so a collection the form no
  // longer holds, or holds only unsaved, has no preview until it is saved.
  const preview = useResource<CollectionPreview>(
    assignmentPath !== undefined &&
      previewedId !== undefined &&
      members.some(
        (member) =>
          member.kind === "collection" && member.sourceId === previewedId,
      )
      ? `${assignmentPath}/preview?mediaCollectionId=${encodeURIComponent(previewedId)}&playbackMode=${mode}`
      : null,
    visible,
  );
  // Reset applies to a saved collection in the saved mode, so it is offered
  // only while the form shows them.
  const resettable =
    preview.data !== undefined && savedMode !== null && mode === savedMode;
  const [resetting, setResetting] = useState(false);
  // Shows the saved assignment until the owner edits the form.
  useEffect(() => {
    if (!assignment || dirty.current) return;
    setMembers(
      assignment.members.map((member) => ({
        kind: member.kind,
        sourceId:
          member.kind === "collection"
            ? member.mediaCollectionId
            : member.mediaItemId,
      })),
    );
    setRotates(assignment.participation === "default");
    if (assignment.playbackMode) setMode(assignment.playbackMode);
    setStretch(toStretchDraft(assignment.ordinaryStretch));
    setStretchSet(true);
    setMarathon(
      assignment.marathonStretch === null
        ? null
        : toStretchDraft(assignment.marathonStretch),
    );
  }, [assignment]);
  // Applies one edit to the member rows and marks the form edited.
  const editMembers = (edit: (rows: MemberDraft[]) => MemberDraft[]) => {
    dirty.current = true;
    setMembers((rows) => edit([...rows]));
  };
  const collectionName = (id: string) =>
    collections?.find((collection) => collection.id === id)?.name ?? id;
  return (
    <fieldset disabled={mutation.pending}>
      <legend>{legend}</legend>
      <RequestFeedback
        loading={mutation.pending}
        error={mutation.error}
        message={mutation.message}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(
            assignmentPath ?? assignmentsPath,
            assignmentPath ? "PATCH" : "POST",
            toSettings(members, rotates, mode, stretch, marathon),
            () => {
              dirty.current = false;
              preview.refresh();
              changed();
            },
          );
        }}
      >
        <MemberRows
          members={members}
          collections={collections}
          visible={visible}
          edit={editMembers}
        />
        <label>
          <input
            type="checkbox"
            checked={rotates}
            onChange={(event) => {
              dirty.current = true;
              setRotates(event.target.checked);
            }}
          />
          Plays in normal rotation
        </label>
        {!rotates && (
          <p className="secondary">
            Airs only while a programming rule selects it.
          </p>
        )}
        {hasCollection && (
          <div className="inline-form">
            <label>
              Playback mode
              <select
                value={mode}
                aria-describedby={hintId}
                onChange={(event) => {
                  dirty.current = true;
                  setMode(event.target.value as PlaybackMode);
                }}
              >
                {PLAYBACK_MODE_CHOICES.map((choice) => (
                  <option key={choice.mode} value={choice.mode}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <small id={hintId} className="secondary">
              {
                PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === mode)
                  ?.hint
              }
            </small>
            <StretchFields
              draft={stretch}
              onChange={(draft) => {
                dirty.current = true;
                setStretchSet(true);
                setStretch(draft);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={marathon !== null}
                onChange={(event) => {
                  dirty.current = true;
                  setMarathon(
                    event.target.checked ? suggestMarathon(stretch) : null,
                  );
                }}
              />
              Allow marathons
            </label>
            {marathon !== null && (
              <StretchFields
                marathon
                draft={marathon}
                onChange={(draft) => {
                  dirty.current = true;
                  setMarathon(draft);
                }}
              />
            )}
            {suggested === null && !stretchSet && (
              <p className="secondary">
                These members mix movies and episodes, or are not classified
                yet. Choose how long each turn runs.
              </p>
            )}
          </div>
        )}
        <div className="row-actions">
          <button
            type="submit"
            disabled={members.some((member) => !member.sourceId)}
          >
            Save programming
          </button>
          {assignmentPath && (
            <button
              type="button"
              onClick={() => {
                void mutation.run(assignmentPath, "DELETE", undefined, changed);
              }}
            >
              Remove assignment
            </button>
          )}
          {resettable && (
            <button type="button" onClick={() => setResetting(true)}>
              Restart from the beginning…
            </button>
          )}
        </div>
      </form>
      {savedCollections.length > 1 && previewedId !== undefined && (
        <label>
          Preview collection
          <select
            value={previewedId}
            onChange={(event) => setPreviewed(event.target.value)}
          >
            {savedCollections.map((id) => (
              <option key={id} value={id}>
                {collectionName(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {resetting &&
        previewedId !== undefined &&
        assignmentPath &&
        savedMode && (
          <ProgressResetDialog
            path={`${assignmentPath}/progress-reset`}
            mediaCollectionId={previewedId}
            collectionName={
              collections?.find((collection) => collection.id === previewedId)
                ?.name ?? "This collection"
            }
            modeLabel={
              PLAYBACK_MODE_CHOICES.find((choice) => choice.mode === savedMode)
                ?.label ?? savedMode
            }
            upcoming={preview.data?.upcoming ?? null}
            upcomingError={preview.error}
            reset={() => {
              preview.refresh();
              changed();
            }}
            onClose={() => setResetting(false)}
          />
        )}
      <RequestFeedback loading={preview.loading} error={preview.error} />
      {preview.data && <ProgrammingPreview preview={preview.data} />}
    </fieldset>
  );
}
/** Asks the server to suggest a turn length for the chosen members. */
function suggestionPath(members: readonly MemberDraft[]): string {
  const ids = (kind: MemberDraft["kind"]) =>
    members
      .filter((member) => member.kind === kind)
      .map((member) => member.sourceId)
      .join(",");
  const query = new URLSearchParams({
    mediaCollectionIds: ids("collection"),
    mediaItemIds: ids("media_item"),
  });
  return `/programming-assignments/stretch-suggestion?${query}`;
}

/**
 * Builds the assignment the form describes: whether it rotates normally,
 * its members in order, and the mode, turn length, and optional marathon
 * length its collections play by. Single items alone take no mode and air once a turn whatever the
 * stretch, so they never become marathons.
 */
function toSettings(
  members: readonly MemberDraft[],
  rotates: boolean,
  mode: PlaybackMode,
  stretch: StretchDraft,
  marathon: StretchDraft | null,
): AssignmentSettings {
  const hasCollection = members.some((member) => member.kind === "collection");
  return {
    participation: rotates ? "default" : "rule_only",
    playbackMode: hasCollection ? mode : null,
    ordinaryStretch: hasCollection
      ? toStretchSetting(stretch)
      : { kind: "programs", count: 1 },
    marathonStretch:
      hasCollection && marathon !== null ? toStretchSetting(marathon) : null,
    members: members.map((member) =>
      member.kind === "collection"
        ? { kind: "collection", mediaCollectionId: member.sourceId }
        : { kind: "media_item", mediaItemId: member.sourceId },
    ),
  };
}
