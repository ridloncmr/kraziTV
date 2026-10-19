import { formText } from "../../controls/form-text.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useMutation } from "../../http/use-resource.js";

/**
 * The General tab: the channel's number and name, saved by **Apply**.
 * Identity editing never exposes source or scheduling policy.
 */
export function GeneralTab({
  channel,
  changed,
}: {
  channel: Channel;
  changed: () => void;
}) {
  const mutation = useMutation();
  return (
    <fieldset disabled={mutation.pending}>
      <legend>Identity</legend>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void mutation.run(
            resourcePath("channels", channel.id),
            "PATCH",
            {
              number: formText(values, "number"),
              name: formText(values, "name"),
            },
            changed,
          );
        }}
      >
        <label>
          Number
          <input name="number" defaultValue={channel.number} required />
        </label>
        <label>
          Name
          <input name="name" defaultValue={channel.name} required />
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
