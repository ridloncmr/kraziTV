import { useEffect, useRef, useState } from "react";
import { ChannelNowNext } from "../channel-observation/channel-now-next.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import {
  rowClickProps,
  rowOpenProps,
} from "../controls/selection/row-click.js";
import { RowMenu } from "../controls/popups/row-menu.js";
import { WindowDialog } from "../controls/dialogs/window-dialog.js";
import type { ProgramId } from "../desktop/contracts.js";
import { usePropertiesList } from "../desktop/windows/use-properties-list.js";
import type { PropertiesWindows } from "../desktop/windows/use-properties-windows.js";
import { resourcePath } from "../http/api-client.js";
import { ApiError } from "../http/api-error.js";
import type { Channel } from "../http/contracts/channels.js";
import type { MediaItemPage } from "../http/contracts/media.js";
import type { ProgrammingRebuild } from "../http/contracts/programming.js";
import { useRefreshScope } from "../http/resources/refresh-scope.js";
import { useMutation, useResource } from "../http/resources/use-resource.js";
import { CreateChannelDialog } from "./identity/create-channel-dialog.js";
import { useCleanupRetries } from "./use-cleanup-retries.js";

/**
 * Channel lifecycle feedback distinguishes persisted identity changes from
 * unfinished runtime cleanup. As in a channel's lineup, a click selects a
 * channel, and double-click, Enter, or **Properties** opens it in Channel
 * Properties, a window of its own beside this one. **Watch** opens TV on an
 * enabled channel. With no channels and an empty catalog, the empty state
 * sends the owner to Media Library first, since a channel needs media.
 */
export function ChannelsApp({
  visible,
  windows,
  onWatch,
  openProgram,
}: {
  visible: boolean;
  /** Each channel's own Channel Properties: opened from here, closed on delete. */
  windows: PropertiesWindows;
  /** Opens TV on the channel. */
  onWatch: (channelId: string) => void;
  /** Opens another program, such as Media Library when the catalog is empty. */
  openProgram: (id: ProgramId) => void;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
  // One item is enough to tell an empty catalog from one with media. The
  // empty state waits for the answer so its words do not change under the
  // owner; a failed read settles on the ordinary words.
  const catalog = useResource<MediaItemPage>("/media-items?limit=1", visible);
  const catalogKnown =
    catalog.data !== undefined || catalog.error !== undefined;
  // Refresh reloads everything this window shows.
  const { refresh: refreshWindow } = useRefreshScope();
  const mutation = useMutation();
  const [selected, setSelected] = useState("");
  const cleanup = useCleanupRetries();
  // `attempted` keeps an earlier action's error out of a newly opened confirmation.
  const [deleting, setDeleting] = useState<{
    channel: Channel;
    attempted: boolean;
  }>();
  const [creating, setCreating] = useState(false);
  const { refresh } = channels;
  // A rename in Channel Properties reads the list again; a created channel
  // opens in its own window once the New channel dialog has closed.
  const openCreated = usePropertiesList(windows, refresh, creating);
  const { remember } = cleanup;
  // Each failed cleanup is handled once: closing a deleted channel's window
  // bumps the revision, which re-runs this effect with the same error.
  const handledError = useRef<unknown>(undefined);
  useEffect(() => {
    const error = mutation.error;
    if (error === handledError.current) return;
    handledError.current = error;
    if (
      error instanceof ApiError &&
      error.code === "channel_runtime_cleanup_failed"
    ) {
      const { channelId, operation, persistenceCommitted } = error.details;
      if (
        typeof channelId === "string" &&
        (operation === "disable" || operation === "delete")
      ) {
        const committed = persistenceCommitted === true;
        remember({
          id: channelId,
          operation,
          committed,
          message: cleanupWords(committed),
        });
        setDeleting(undefined);
        // A committed delete leaves nothing for its Properties window to
        // edit; closing it also reads the list again.
        if (operation === "delete" && committed) windows.deleted(channelId);
        else refresh();
      }
    }
  }, [mutation.error, refresh, remember, windows]);
  // Cleanup responses are authoritative about committed persistence even if the follow-up read fails.
  const displayedChannels = channels.data
    ?.filter(
      (channel) =>
        !cleanup.retries.some(
          (retry) =>
            retry.id === channel.id &&
            retry.operation === "delete" &&
            retry.committed,
        ),
    )
    .map((channel) =>
      cleanup.retries.some(
        (retry) => retry.id === channel.id && retry.operation === "disable",
      )
        ? { ...channel, enabled: false }
        : channel,
    );
  // A pending disable or delete must finish before the channel's lifecycle
  // changes again; a rebuild retry does not block it, since both stop the worker.
  const lifecycleRetryPending = (channelId: string) =>
    cleanup.retries.some(
      (retry) => retry.id === channelId && retry.operation !== "rebuild",
    );
  const selectedChannel = displayedChannels?.find(
    (channel) => channel.id === selected,
  );
  /** One channel's commands, shared by its row menu and the buttons under the grid. */
  const actionsFor = (channel: Channel) => {
    const blocked = mutation.pending || lifecycleRetryPending(channel.id);
    return {
      watch: {
        label: "Watch",
        // A disabled channel broadcasts nothing to watch.
        disabled: !channel.enabled,
        onSelect: () => onWatch(channel.id),
      },
      properties: {
        label: "Properties",
        disabled: false,
        onSelect: () => open(channel),
      },
      toggle: {
        label: channel.enabled ? "Disable" : "Enable",
        disabled: blocked,
        onSelect: () => {
          void mutation.run(
            resourcePath("channels", channel.id),
            "PATCH",
            { enabled: !channel.enabled },
            () => {
              if (channel.enabled) cleanup.settle(channel.id, "disable");
              channels.refresh();
            },
          );
        },
      },
      remove: {
        label: "Delete…",
        disabled: blocked,
        onSelect: () => setDeleting({ channel, attempted: false }),
      },
    };
  };
  /** Selects a channel and opens it in Channel Properties. */
  function open(channel: Channel) {
    setSelected(channel.id);
    windows.show(channel);
  }
  const selectedActions = selectedChannel && actionsFor(selectedChannel);
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <div className="row-actions">
          <button onClick={() => setCreating(true)}>New channel…</button>
          <button onClick={refreshWindow}>Refresh</button>
        </div>
      </div>
      <p className="program-intro">
        Give each channel an identity and a programming source. kraziTV handles
        what airs and when.
      </p>
      {/* An open confirmation reports its own request, and a failed runtime
          stop has its own notice below, so the page repeats neither. */}
      <RequestFeedback
        loading={channels.loading || (!deleting && mutation.pending)}
        error={
          (deleting || isCleanupFailure(mutation.error)
            ? undefined
            : mutation.error) ?? channels.error
        }
        message={deleting ? undefined : mutation.message}
      />
      {cleanup.retries.map((retry) => (
        <div
          key={`${retry.operation}-${retry.id}`}
          className="cleanup-notice"
          role="alert"
        >
          <strong>
            {retry.operation === "rebuild"
              ? "Schedule rebuilt with fresh programming."
              : retry.committed
                ? `Channel ${retry.operation === "delete" ? "deleted" : "disabled"}. Configuration saved.`
                : "Channel remains disabled. Re-enable was not saved."}
          </strong>
          <p>{retry.message}</p>
          <button
            disabled={mutation.pending}
            onClick={() => {
              // A rebuild retry repeats its key, so the server only stops
              // the worker again; it stays listed while the stop still fails.
              if (retry.operation === "rebuild") {
                void mutation.run<ProgrammingRebuild>(
                  `${resourcePath("channels", retry.id)}/programming/rebuild`,
                  "POST",
                  { idempotencyKey: retry.key },
                  (result) => {
                    if (!result.stopFailed) cleanup.settle(retry.id, "rebuild");
                  },
                );
                return;
              }
              void mutation.run(
                resourcePath("channels", retry.id),
                retry.operation === "delete" ? "DELETE" : "PATCH",
                retry.operation === "delete" ? undefined : { enabled: false },
                () => {
                  cleanup.settle(retry.id, retry.operation);
                  channels.refresh();
                },
              );
            }}
          >
            Retry runtime cleanup
          </button>
        </div>
      ))}
      {displayedChannels?.length === 0 && catalogKnown && (
        <div className="empty-state">
          {catalog.data?.total === 0 ? (
            <>
              <p>
                Add your media in Media Library first, then create a channel.
              </p>
              <button onClick={() => openProgram("media")}>
                Open Media Library
              </button>
            </>
          ) : (
            <>
              <p>
                No channels yet. Create a channel, then assign its programming
                source.
              </p>
              <button onClick={() => setCreating(true)}>
                Create a channel…
              </button>
            </>
          )}
        </div>
      )}
      {displayedChannels && displayedChannels.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="narrow-column">Number</th>
                <th>Channel</th>
                <th>On now</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {displayedChannels.map((channel) => (
                <tr
                  key={channel.id}
                  className={`clickable-row${channel.id === selected ? " selected-row" : ""}`}
                  {...rowClickProps(() => setSelected(channel.id))}
                  {...rowOpenProps(() => open(channel))}
                >
                  <td className="narrow-column">{channel.number}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(channel.id)}
                    >
                      {channel.name}
                    </button>
                    {!channel.enabled && (
                      <span className="row-badge">Disabled</span>
                    )}
                  </td>
                  <td>
                    <ChannelNowNext channel={channel} visible={visible} />
                  </td>
                  <td>
                    <RowMenu
                      label={`Actions for ${channel.name}`}
                      items={Object.values(actionsFor(channel))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {displayedChannels && displayedChannels.length > 0 && (
        <div className="row-actions">
          <button
            disabled={!selectedActions || selectedActions.watch.disabled}
            onClick={selectedActions?.watch.onSelect}
          >
            Watch
          </button>
          <button
            disabled={!selectedActions}
            onClick={selectedActions?.properties.onSelect}
          >
            Properties
          </button>
          <button
            disabled={!selectedActions || selectedActions.toggle.disabled}
            onClick={selectedActions?.toggle.onSelect}
          >
            {selectedActions?.toggle.label ?? "Disable"}
          </button>
          <button
            disabled={!selectedActions || selectedActions.remove.disabled}
            onClick={selectedActions?.remove.onSelect}
          >
            Delete…
          </button>
        </div>
      )}
      {creating && (
        <CreateChannelDialog
          created={(channel) => {
            setCreating(false);
            setSelected(channel.id);
            openCreated(channel);
            channels.refresh();
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <WindowDialog
          title="Delete channel"
          busy={mutation.pending}
          onClose={() => setDeleting(undefined)}
        >
          <p>
            Delete channel{" "}
            <strong>
              {deleting.channel.number} · {deleting.channel.name}
            </strong>
            ? This removes its configuration and stops its broadcast.
          </p>
          <RequestFeedback
            loading={mutation.pending}
            error={deleting.attempted ? mutation.error : undefined}
          />
          <div className="dialog-actions">
            <button
              disabled={mutation.pending}
              onClick={() => {
                setDeleting({ ...deleting, attempted: true });
                void mutation.run(
                  resourcePath("channels", deleting.channel.id),
                  "DELETE",
                  undefined,
                  () => {
                    cleanup.settle(deleting.channel.id, "delete");
                    // Closing its window also reads the list again.
                    windows.deleted(deleting.channel.id);
                    setDeleting(undefined);
                    setSelected("");
                  },
                );
              }}
            >
              Delete channel permanently
            </button>
            <button
              disabled={mutation.pending}
              onClick={() => setDeleting(undefined)}
            >
              Cancel
            </button>
          </div>
        </WindowDialog>
      )}
    </div>
  );
}

/** Whether a request failed only because its runtime stop did not finish, which the cleanup notice reports. */
function isCleanupFailure(error: Error | undefined): boolean {
  return (
    error instanceof ApiError && error.code === "channel_runtime_cleanup_failed"
  );
}

/**
 * Says what a failed runtime stop left to do. The server's message is for
 * logs; the owner reads these words (release-polish spec 0002), and the
 * notice's heading already says whether the change saved.
 */
function cleanupWords(committed: boolean): string {
  return committed
    ? "The channel's broadcast did not stop cleanly. Retry to finish stopping it."
    : "An earlier stop of the channel's broadcast did not finish. Retry it, then enable the channel again.";
}
