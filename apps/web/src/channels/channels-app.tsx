import { useEffect, useRef, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { rowClickProps } from "../controls/row-click.js";
import { inRowMenu, RowMenu } from "../controls/row-menu.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { resourcePath } from "../http/api-client.js";
import { ApiError } from "../http/api-error.js";
import type { Channel } from "../http/contracts/channels.js";
import type { ProgrammingRebuild } from "../http/contracts/programming.js";
import { useRefreshScope } from "../http/resources/refresh-scope.js";
import { useMutation, useResource } from "../http/resources/use-resource.js";
import { CreateChannelDialog } from "./identity/create-channel-dialog.js";
import { useCleanupRetries } from "./use-cleanup-retries.js";

/**
 * Channel lifecycle feedback distinguishes persisted identity changes from
 * unfinished runtime cleanup. As in a channel's lineup, a click selects a
 * channel, and double-click, Enter, or **Properties** opens it in Channel
 * Properties, a window of its own beside this one.
 */
export function ChannelsApp({
  visible,
  channelsRevision,
  onShowProperties,
  onDeleted,
}: {
  visible: boolean;
  /** Counts channel changes made in Channel Properties, such as a rename. */
  channelsRevision: number;
  /** Opens a channel's own Channel Properties, or focuses it when already open. */
  onShowProperties: (channel: Channel) => void;
  /** Reports a deleted channel, so its Channel Properties closes. */
  onDeleted: (channelId: string) => void;
}) {
  const channels = useResource<Channel[]>("/channels", visible);
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
  // A created channel opens in Channel Properties only once the New channel
  // dialog has returned focus to this window, or that focus would bring this
  // window back over the one just opened.
  const created = useRef<Channel>(undefined);
  useEffect(() => {
    if (creating || !created.current) return;
    onShowProperties(created.current);
    created.current = undefined;
  }, [creating, onShowProperties]);
  const { refresh } = channels;
  // A channel changed in Channel Properties, as by a rename there, so the
  // list reads again to match. The first render already reads it.
  const seenRevision = useRef(channelsRevision);
  useEffect(() => {
    if (seenRevision.current === channelsRevision) return;
    seenRevision.current = channelsRevision;
    refresh();
  }, [channelsRevision, refresh]);
  const { remember } = cleanup;
  useEffect(() => {
    const error = mutation.error;
    if (
      error instanceof ApiError &&
      error.code === "channel_runtime_cleanup_failed"
    ) {
      const { channelId, operation, persistenceCommitted } = error.details;
      if (
        typeof channelId === "string" &&
        (operation === "disable" || operation === "delete")
      ) {
        remember({
          id: channelId,
          operation,
          committed: persistenceCommitted === true,
          message: error.message,
        });
        setDeleting(undefined);
        refresh();
      }
    }
  }, [mutation.error, refresh, remember]);
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
    onShowProperties(channel);
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
      {/* An open confirmation reports its own request, so the page does not repeat it. */}
      <RequestFeedback
        loading={channels.loading || (!deleting && mutation.pending)}
        error={(deleting ? undefined : mutation.error) ?? channels.error}
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
      {displayedChannels?.length === 0 && (
        <div className="empty-state">
          <p>
            No channels yet. Create a channel, then assign its programming
            source.
          </p>
          <button onClick={() => setCreating(true)}>Create a channel…</button>
        </div>
      )}
      {displayedChannels && displayedChannels.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="narrow-column">Number</th>
                <th>Channel</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {displayedChannels.map((channel) => (
                <tr
                  key={channel.id}
                  className={`clickable-row${channel.id === selected ? " selected-row" : ""}`}
                  {...rowClickProps(() => setSelected(channel.id))}
                  onDoubleClick={(event) => {
                    if (!inRowMenu(event.target)) open(channel);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || inRowMenu(event.target)) {
                      return;
                    }
                    event.preventDefault();
                    open(channel);
                  }}
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
            created.current = channel;
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
                    onDeleted(deleting.channel.id);
                    setDeleting(undefined);
                    setSelected("");
                    channels.refresh();
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
