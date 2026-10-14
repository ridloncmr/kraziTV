import { useEffect, useId, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import type {
  AssignmentMember,
  AssignmentSettings,
  CollectionPreview,
  MediaCollection,
  PlaybackMode,
  SourceAssignment,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { MediaItemPicker } from "../media-search/media-item-picker.js";
import { ProgrammingPreview } from "./programming-preview.js";
import { ProgressResetDialog } from "./progress-reset-dialog.js";

// Every playback mode the editor offers, with the one line that explains it.
const PLAYBACK_MODE_CHOICES: readonly {
  mode: PlaybackMode;
  label: string;
  hint: string;
}[] = [
  {
    mode: "chronological",
    label: "Collection order",
    hint: "Plays the collection in its saved order.",
  },
  {
    mode: "episode",
    label: "Episode order",
    hint: "Plays by series, season, and episode; items without episode details play last, in saved order.",
  },
  {
    mode: "release",
    label: "Release order",
    hint: "Plays by release or air date, earliest first; items without a date play last, in saved order.",
  },
  {
    mode: "random",
    label: "Random",
    hint: "Picks reproducibly at random from the collection; items can repeat.",
  },
];

// The ordinary stretch a new collection assignment starts with.
const DEFAULT_PROGRAM_COUNT = 3;

/** One member row as the form edits it; an empty source is not chosen yet. */
interface MemberDraft {
  kind: AssignmentMember["kind"];
  sourceId: string;
}

const NEW_MEMBER: MemberDraft = { kind: "collection", sourceId: "" };

/**
 * Edits one programming source assignment, or adds one when none is given:
 * members in saved order, each a collection or a single item, with the
 * playback mode and programs per turn its collections play by. Each turn
 * goes to the next member, and a single item airs once a turn. It previews
 * and restarts one saved collection at a time; `changed` runs after every
 * write the server accepted.
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
  const [count, setCount] = useState(DEFAULT_PROGRAM_COUNT);
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
    if (assignment.playbackMode) setMode(assignment.playbackMode);
    setCount(assignment.ordinaryStretch.count);
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
            toSettings(members, mode, count),
            () => {
              dirty.current = false;
              preview.refresh();
              changed();
            },
          );
        }}
      >
        <ol aria-label="Members">
          {members.map((member, index) => (
            <li key={index} className="inline-form">
              <label>
                Source type
                <select
                  value={member.kind}
                  onChange={(event) => {
                    const kind = event.target.value as MemberDraft["kind"];
                    editMembers((rows) =>
                      rows.map((row, at) =>
                        at === index ? { kind, sourceId: "" } : row,
                      ),
                    );
                  }}
                >
                  <option value="collection">Media collection</option>
                  <option value="media_item">Single media item</option>
                </select>
              </label>
              {member.kind === "collection" ? (
                <label>
                  Programming source
                  <select
                    required
                    value={member.sourceId}
                    onChange={(event) => {
                      const sourceId = event.target.value;
                      editMembers((rows) =>
                        rows.map((row, at) =>
                          at === index ? { ...row, sourceId } : row,
                        ),
                      );
                    }}
                  >
                    <option value="">Choose a source</option>
                    {collections?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <MediaItemPicker
                  label="Programming source"
                  value={member.sourceId}
                  visible={visible}
                  onChange={(item) => {
                    const sourceId = item?.id ?? "";
                    editMembers((rows) =>
                      rows.map((row, at) =>
                        at === index ? { ...row, sourceId } : row,
                      ),
                    );
                  }}
                />
              )}
              {members.length > 1 && (
                <span className="row-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() =>
                      editMembers((rows) => moveRow(rows, index, -1))
                    }
                  >
                    Move member up
                  </button>
                  <button
                    type="button"
                    disabled={index === members.length - 1}
                    onClick={() =>
                      editMembers((rows) => moveRow(rows, index, 1))
                    }
                  >
                    Move member down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      editMembers((rows) =>
                        rows.filter((_, at) => at !== index),
                      )
                    }
                  >
                    Remove member
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => editMembers((rows) => [...rows, NEW_MEMBER])}
        >
          Add member
        </button>
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
            <label>
              Programs per turn
              <input
                type="number"
                required
                min={1}
                step={1}
                value={count}
                onChange={(event) => {
                  dirty.current = true;
                  setCount(event.target.valueAsNumber);
                }}
              />
            </label>
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

/** Moves one member row a place earlier or later. */
function moveRow(
  rows: MemberDraft[],
  index: number,
  offset: -1 | 1,
): MemberDraft[] {
  const [moved] = rows.splice(index, 1);
  if (moved !== undefined) rows.splice(index + offset, 0, moved);
  return rows;
}

/**
 * Builds the assignment the form describes: its members in order, with the
 * mode and programs per turn its collections play by. Single items alone
 * take no mode and air once a turn whatever the stretch.
 */
function toSettings(
  members: readonly MemberDraft[],
  mode: PlaybackMode,
  count: number,
): AssignmentSettings {
  const hasCollection = members.some((member) => member.kind === "collection");
  return {
    playbackMode: hasCollection ? mode : null,
    ordinaryStretch: { kind: "programs", count: hasCollection ? count : 1 },
    members: members.map((member) =>
      member.kind === "collection"
        ? { kind: "collection", mediaCollectionId: member.sourceId }
        : { kind: "media_item", mediaItemId: member.sourceId },
    ),
  };
}
