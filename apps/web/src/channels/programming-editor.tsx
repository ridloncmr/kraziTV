import { useEffect, useMemo, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type {
  BlockSource,
  MediaCollection,
  ProgrammingBlock,
  ScheduleWindow,
} from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { MediaItemPicker } from "../media-search/media-item-picker.js";
import { scheduleWindowPath } from "../schedule-view/schedule-window-path.js";

/** Sends the explicit either/or source contract; the server regenerates and returns schedule observations. */
export function ProgrammingEditor({
  channelId,
  visible,
}: {
  channelId: string;
  visible: boolean;
}) {
  const path = `${resourcePath("channels", channelId)}/programming-blocks`;
  const blocks = useResource<ProgrammingBlock[]>(path, visible);
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const mutation = useMutation();
  const [kind, setKind] = useState<BlockSource["kind"]>("collection");
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState<"chronological" | "random">("chronological");
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
  const block = blocks.data?.[0];
  useEffect(() => {
    if (!block || dirty.current) return;
    setKind(block.source.kind);
    setSourceId(
      block.source.kind === "collection"
        ? block.source.mediaCollectionId
        : block.source.mediaItemId,
    );
    if (block.source.kind === "collection") setMode(block.source.playbackMode);
  }, [block]);
  return (
    <fieldset disabled={mutation.pending || blocks.loading}>
      <legend>Programming block</legend>
      <RequestFeedback
        loading={blocks.loading || collections.loading || mutation.pending}
        error={mutation.error ?? blocks.error ?? collections.error}
        message={mutation.message}
      />
      {blocks.data?.length === 0 && (
        <p className="empty-state">
          No programming block. Choose one source to begin broadcasting.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const source: BlockSource =
            kind === "collection"
              ? { kind, mediaCollectionId: sourceId, playbackMode: mode }
              : { kind, mediaItemId: sourceId };
          void mutation.run(
            block ? `${path}/${encodeURIComponent(block.id)}` : path,
            block ? "PATCH" : "POST",
            { source },
            () => {
              dirty.current = false;
              blocks.refresh();
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
                setKind(event.target.value as BlockSource["kind"]);
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
            <label>
              Playback mode
              <select
                value={mode}
                onChange={(event) => {
                  dirty.current = true;
                  setMode(event.target.value as "chronological" | "random");
                }}
              >
                <option value="chronological">
                  Chronological (collection order)
                </option>
                <option value="random">Random (deterministic)</option>
              </select>
            </label>
          )}
        </div>
        <div className="row-actions">
          <button type="submit" disabled={!sourceId || !blocks.data}>
            Save programming
          </button>
          {block && (
            <button
              type="button"
              onClick={() => {
                void mutation.run(
                  `${path}/${encodeURIComponent(block.id)}`,
                  "DELETE",
                  undefined,
                  () => {
                    blocks.refresh();
                    setShowSchedule(true);
                    schedule.refresh();
                    setSourceId("");
                  },
                );
              }}
            >
              Remove programming block
            </button>
          )}
        </div>
      </form>
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
