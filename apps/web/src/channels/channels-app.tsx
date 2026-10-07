import { useEffect, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { rowClickProps } from "../controls/row-click.js";
import { WindowDialog } from "../controls/window-dialog.js";
import { resourcePath } from "../http/api-client.js";
import { ApiError } from "../http/api-error.js";
import type { Channel } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { ChannelEditor } from "./channel-editor.js";
import { CreateChannelDialog } from "./create-channel-dialog.js";
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
        cleanup.remember({
          id: channelId,
          operation,
          committed: persistenceCommitted === true,
          message: error.message,
        });
        setDeleting(undefined);
        channels.refresh();
      }
    }
  }, [mutation.error, channels.refresh, cleanup.remember]);
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
        <div key={retry.id} className="cleanup-notice" role="alert">
          <strong>
            {retry.committed
              ? `Channel ${retry.operation === "delete" ? "deleted" : "disabled"}. Configuration saved.`
              : "Channel remains disabled. Re-enable was not saved."}
          </strong>
          <p>{retry.message}</p>
          <button
            disabled={mutation.pending}
            onClick={() => {
              void mutation.run(
                resourcePath("channels", retry.id),
                retry.operation === "delete" ? "DELETE" : "PATCH",
                retry.operation === "delete" ? undefined : { enabled: false },
                () => {
                  cleanup.settle(retry.id);
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
                          mutation.pending ||
                          cleanup.retries.some(
                            (retry) => retry.id === channel.id,
                          )
                        }
                        onClick={() => {
                          void mutation.run(
                            resourcePath("channels", channel.id),
                            "PATCH",
                            { enabled: !channel.enabled },
                            channels.refresh,
                          );
                        }}
                      >
                        {channel.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        disabled={
                          mutation.pending ||
                          cleanup.retries.some(
                            (retry) => retry.id === channel.id,
                          )
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
        <ChannelEditor
          key={selectedChannel.id}
          channel={selectedChannel}
          visible={visible}
          changed={channels.refresh}
        />
      )}
    </div>
  );
}
