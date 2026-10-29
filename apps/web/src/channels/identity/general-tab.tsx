import { useState } from "react";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { useUnsavedReport } from "../../desktop/windows/use-unsaved-report.js";
import { resourcePath } from "../../http/api-client.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useMutation } from "../../http/resources/use-resource.js";

/**
 * The General tab: the channel's number and name, saved by **Apply**.
 * Identity editing never exposes source or scheduling policy. A number or
 * name that differs from the channel's, ignoring the spaces the server trims,
 * counts as unsaved, so closing the window asks first.
 */
export function GeneralTab({
  channel,
  changed,
  onDirtyChange,
}: {
  channel: Channel;
  changed: () => void;
  /** Reports whether the fields hold edits not yet applied. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const mutation = useMutation();
  const [number, setNumber] = useState(channel.number);
  const [name, setName] = useState(channel.name);
  useUnsavedReport(
    number.trim() !== channel.number || name.trim() !== channel.name,
    onDirtyChange,
  );
  return (
    <fieldset disabled={mutation.pending}>
      <legend>Identity</legend>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run(
            resourcePath("channels", channel.id),
            "PATCH",
            { number, name },
            changed,
          );
        }}
      >
        <label>
          Number
          <input
            name="number"
            inputMode="decimal"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            required
          />
        </label>
        <label>
          Name
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <button type="submit">Apply</button>
      </form>
      <RequestFeedback
        loading={mutation.pending}
        error={mutation.error}
        message={mutation.message}
      />
    </fieldset>
  );
}
