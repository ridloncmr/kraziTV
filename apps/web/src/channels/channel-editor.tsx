import { formText } from "../controls/form-text.js";
import { RequestFeedback } from "../controls/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type { Channel } from "../http/contracts.js";
import { useMutation } from "../http/use-resource.js";
import { ProgrammingEditor } from "./programming-editor.js";

/** Identity editing never exposes source or scheduling policy on the channel itself. */
export function ChannelEditor({
  channel,
  visible,
  changed,
}: {
  channel: Channel;
  visible: boolean;
  changed: () => void;
}) {
  const mutation = useMutation();
  return (
    <>
      <fieldset disabled={mutation.pending}>
        <legend>
          {channel.number} · {channel.name}
        </legend>
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
          <button type="submit">Save identity</button>
        </form>
        <RequestFeedback
          loading={mutation.pending}
          error={mutation.error}
          message={mutation.message}
        />
      </fieldset>
      <ProgrammingEditor channelId={channel.id} visible={visible} />
    </>
  );
}
