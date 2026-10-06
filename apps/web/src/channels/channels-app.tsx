import { formText } from "../controls/form-text.js";
import { useEffect, useState } from "react";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import { ApiError } from "../http/api-error.js";
import type { Channel } from "../http/contracts.js";
import { useMutation, useResource } from "../http/use-resource.js";
import { ChannelEditor } from "./channel-editor.js";
import { useCleanupRetries } from "./use-cleanup-retries.js";

/** Channel lifecycle feedback distinguishes persisted identity changes from unfinished runtime cleanup. */
export function ChannelsApp({ visible }: { visible: boolean }) {
  const channels = useResource<Channel[]>("/channels", visible);
  const mutation = useMutation();
  const [selected, setSelected] = useState("");
  const cleanup = useCleanupRetries();
  const [deleting, setDeleting] = useState<Channel>();
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
        <button onClick={channels.refresh}>Refresh</button>
      </div>
      <p className="program-intro">
        Give each channel an identity and a programming source. kraziTV handles
        what airs and when.
      </p>
      <RequestFeedback
        loading={channels.loading || mutation.pending}
        error={mutation.error ?? channels.error}
        message={mutation.message}
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
      <fieldset disabled={mutation.pending}>
        <legend>Create channel</legend>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              values = new FormData(form);
            void mutation.run<Channel>(
              "/channels",
              "POST",
              {
                number: formText(values, "number"),
                name: formText(values, "name"),
              },
              (channel) => {
                form.reset();
                setSelected(channel.id);
                channels.refresh();
              },
            );
          }}
        >
          <label>
            Channel number
            <input name="number" required placeholder="69 or 69.1" />
          </label>
          <label>
            Channel name
            <input name="name" required />
          </label>
          <button type="submit">Create channel</button>
        </form>
      </fieldset>
      {displayedChannels?.length === 0 && (
        <p className="empty-state">
          No channels yet. Create a channel, then assign its programming source.
        </p>
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
                  className={channel.id === selected ? "selected-row" : ""}
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
                        onClick={() => setDeleting(channel)}
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
      {deleting && (
        <div className="destructive-confirmation">
          <p>
            Delete channel{" "}
            <strong>
              {deleting.number} · {deleting.name}
            </strong>
            ? This removes its configuration and stops its broadcast.
          </p>
          <button
            disabled={mutation.pending}
            onClick={() => {
              void mutation.run(
                resourcePath("channels", deleting.id),
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
