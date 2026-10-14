import { useEffect, useMemo, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  AssignmentMember,
  AssignmentSettings,
  CollectionPreview,
  MediaCollection,
  PlaybackMode,
  ScheduleWindow,
  SourceAssignment,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { MediaItemPicker } from "../media-search/media-item-picker.js";
import { scheduleWindowPath } from "../schedule-view/schedule-window-path.js";
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

/**
 * Edits the channel's one programming source assignment: a collection in a
 * playback mode for a number of programs a turn, or a single item that airs
 * once a turn. The server regenerates and returns schedule observations.
 */
export function ProgrammingEditor({
  channelId,
  visible,
}: {
  channelId: string;
  visible: boolean;
}) {
  const path = `${resourcePath("channels", channelId)}/programming-assignments`;
  const assignments = useResource<SourceAssignment[]>(path, visible);
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const mutation = useMutation();
  const [kind, setKind] = useState<AssignmentMember["kind"]>("collection");
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState<PlaybackMode>("chronological");
  const [count, setCount] = useState(DEFAULT_PROGRAM_COUNT);
  const [showSchedule, setShowSchedule] = useState(false);
  const dirty = useRef(false);
  const schedulePath = useMemo(
    () => scheduleWindowPath(channelId),
    [channelId, visible],
  );
  const schedule = useResource<ScheduleWindow>(
    showSchedule ? schedulePath : null,
    visible,
  );
  const assignment = assignments.data?.[0];
  const assignmentPath = assignment
    ? `${path}/${encodeURIComponent(assignment.id)}`
    : undefined;
  const savedMember = assignment?.members[0];
  // The saved collection and the mode its assignment plays it in, if any.
  const saved =
    savedMember?.kind === "collection" && assignment?.playbackMode
      ? {
          mediaCollectionId: savedMember.mediaCollectionId,
          playbackMode: assignment.playbackMode,
        }
      : undefined;
  // The server previews the saved collection only, so an unsaved collection
  // choice has no preview until it is saved.
  const preview = useResource<CollectionPreview>(
    assignmentPath !== undefined &&
      saved !== undefined &&
      kind === "collection" &&
      sourceId === saved.mediaCollectionId
      ? `${assignmentPath}/preview?mediaCollectionId=${encodeURIComponent(sourceId)}&playbackMode=${mode}`
      : null,
    visible,
  );
  // Reset applies to the saved collection and mode, so it is offered only
  // while the form shows them.
  const resettable =
    saved !== undefined &&
    kind === "collection" &&
    sourceId === saved.mediaCollectionId &&
    mode === saved.playbackMode;
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!assignment || !savedMember || dirty.current) return;
    setKind(savedMember.kind);
    setSourceId(
      savedMember.kind === "collection"
        ? savedMember.mediaCollectionId
        : savedMember.mediaItemId,
    );
    if (assignment.playbackMode) setMode(assignment.playbackMode);
    setCount(assignment.ordinaryStretch.count);
  }, [assignment, savedMember]);
  return (
    <fieldset disabled={mutation.pending || assignments.loading}>
      <legend>Programming</legend>
      <RequestFeedback
        loading={assignments.loading || collections.loading || mutation.pending}
        error={mutation.error ?? assignments.error ?? collections.error}
        message={mutation.message}
      />
      {assignments.data?.length === 0 && (
        <p className="empty-state">
          No programming assigned. Choose one source to begin broadcasting.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(
            assignmentPath ?? path,
            assignmentPath ? "PATCH" : "POST",
            toSettings(kind, sourceId, mode, count),
            () => {
              dirty.current = false;
              assignments.refresh();
              preview.refresh();
              setShowSchedule(true);
              schedule.refresh();
            },
          );
        }}
      >
        <div className="inline-form">
          <label>
            Source type
            <select
              value={kind}
              onChange={(event) => {
                dirty.current = true;
                setKind(event.target.value as AssignmentMember["kind"]);
                setSourceId("");
              }}
            >
              <option value="collection">Media collection</option>
              <option value="media_item">Single media item</option>
            </select>
          </label>
          {kind === "collection" ? (
            <label>
              Programming source
              <select
                required
                value={sourceId}
                onChange={(event) => {
                  dirty.current = true;
                  setSourceId(event.target.value);
                }}
              >
                <option value="">Choose a source</option>
                {collections.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <MediaItemPicker
              label="Programming source"
              value={sourceId}
              visible={visible}
              onChange={(item) => {
                dirty.current = true;
                setSourceId(item?.id ?? "");
              }}
            />
          )}
          {kind === "collection" && (
            <>
              <label>
                Playback mode
                <select
                  value={mode}
                  aria-describedby="playback-mode-hint"
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
              <small id="playback-mode-hint" className="secondary">
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
            </>
          )}
        </div>
        <div className="row-actions">
          <button type="submit" disabled={!sourceId || !assignments.data}>
            Save programming
          </button>
          {assignmentPath && (
            <button
              type="button"
              onClick={() => {
                void mutation.run(assignmentPath, "DELETE", undefined, () => {
                  assignments.refresh();
                  setShowSchedule(true);
                  schedule.refresh();
                  setSourceId("");
                });
              }}
            >
              Remove programming
            </button>
          )}
          {resettable && (
            <button type="button" onClick={() => setResetting(true)}>
              Restart from the beginning…
            </button>
          )}
        </div>
      </form>
      {resetting && saved !== undefined && assignmentPath && (
        <ProgressResetDialog
          path={`${assignmentPath}/progress-reset`}
          mediaCollectionId={saved.mediaCollectionId}
          collectionName={
            collections.data?.find(
              (collection) => collection.id === saved.mediaCollectionId,
            )?.name ?? "This collection"
          }
          modeLabel={
            PLAYBACK_MODE_CHOICES.find(
              (choice) => choice.mode === saved.playbackMode,
            )?.label ?? saved.playbackMode
          }
          upcoming={preview.data?.upcoming ?? null}
          upcomingError={preview.error}
          reset={() => {
            preview.refresh();
            setShowSchedule(true);
            schedule.refresh();
          }}
          onClose={() => setResetting(false)}
        />
      )}
      <RequestFeedback loading={preview.loading} error={preview.error} />
      {preview.data && kind === "collection" && (
        <ProgrammingPreview preview={preview.data} />
      )}
      {showSchedule && (
        <>
          <RequestFeedback loading={schedule.loading} error={schedule.error} />
          {schedule.data && (
            <p>
              Backend schedule: {schedule.data.entries.length} entries ·
              revision {schedule.data.scheduleRevision}. Open Program Guide to
              inspect air times.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

/**
 * Builds the assignment the form describes: a collection in its mode for
 * the chosen programs a turn, or one item, which airs once a turn whatever
 * its stretch.
 */
function toSettings(
  kind: AssignmentMember["kind"],
  sourceId: string,
  mode: PlaybackMode,
  count: number,
): AssignmentSettings {
  return kind === "collection"
    ? {
        playbackMode: mode,
        ordinaryStretch: { kind: "programs", count },
        members: [{ kind, mediaCollectionId: sourceId }],
      }
    : {
        playbackMode: null,
        ordinaryStretch: { kind: "programs", count: 1 },
        members: [{ kind, mediaItemId: sourceId }],
      };
}
