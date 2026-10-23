import { useEffect, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { rowClickProps } from "../controls/row-click.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { resourcePath } from "../http/api-client.js";
import { ApiError } from "../http/api-error.js";
import type { Channel } from "../http/contracts/channels.js";
import type { ProgrammingRebuild } from "../http/contracts/programming.js";
import { useMutation, useResource } from "../http/use-resource.js";
import {
  type ChannelTab,
  ChannelPropertySheet,
} from "./channel-property-sheet.js";
import { CreateChannelDialog } from "./identity/create-channel-dialog.js";
import { useCleanupRetries } from "./use-cleanup-retries.js";

/** Channel lifecycle feedback distinguishes persisted identity changes from unfinished runtime cleanup. */
export function ChannelsApp({ visible }: { visible: boolean }) {
  const channels = useResource<Channel[]>("/channels", visible);
  const mutation = useMutation();
  const [selected, setSelected] = useState("");
  const cleanup = useCleanupRetries();
  // `attempted` keeps an earlier action's error out of a newly opened confirmation.
  const [deleting, setDeleting] = useState<{
    channel: Channel;
    attempted: boolean;
  }>();
  const [creating, setCreating] = useState(false);
  // The property sheet's tab stays while the window is open, across channels.
  const [tab, setTab] = useState<ChannelTab>("general");
  const { refresh } = channels;
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
  return (
    <div className="program-page">
      <div className="program-toolbar">
        <span>My Channels</span>
        <div className="row-actions">
          <button onClick={() => setCreating(true)}>New channel…</button>
          <button onClick={channels.refresh}>Refresh</button>
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
                <th>Number</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedChannels.map((channel) => (
                <tr
                  key={channel.id}
                  className={`clickable-row${channel.id === selected ? " selected-row" : ""}`}
                  {...rowClickProps(() => setSelected(channel.id))}
                >
                  <td>{channel.number}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelected(channel.id)}
                    >
                      {channel.name}
                    </button>
                  </td>
                  <td>{channel.enabled ? "Enabled" : "Disabled"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        disabled={
                          mutation.pending || lifecycleRetryPending(channel.id)
                        }
                        onClick={() => {
                          void mutation.run(
                            resourcePath("channels", channel.id),
                            "PATCH",
                            { enabled: !channel.enabled },
                            () => {
                              if (channel.enabled)
                                cleanup.settle(channel.id, "disable");
                              channels.refresh();
                            },
                          );
                        }}
                      >
                        {channel.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        disabled={
                          mutation.pending || lifecycleRetryPending(channel.id)
                        }
                        onClick={() =>
                          setDeleting({ channel, attempted: false })
                        }
                      >
                        Delete…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <CreateChannelDialog
          created={(channel) => {
            setCreating(false);
            setSelected(channel.id);
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
      {selectedChannel && (
        <ChannelPropertySheet
          key={selectedChannel.id}
          channel={selectedChannel}
          visible={visible}
          tab={tab}
          onTabChange={setTab}
          changed={channels.refresh}
        />
      )}
    </div>
  );
}
