import { useState } from "react";
import { RequestFeedback } from "../../controls/dialogs/request-feedback.js";
import { SheetFooter } from "../../controls/sheet-footer/sheet-footer.js";
import { UnsavedChangesDialog } from "../../controls/dialogs/unsaved-changes-dialog.js";
import { useCloseWindow } from "../../desktop/windows/close-window.js";
import { useUnsavedReport } from "../../desktop/windows/use-unsaved-report.js";
import { resourcePath } from "../../http/api-client.js";
import type { Channel } from "../../http/contracts/channels.js";
import { useMutation } from "../../http/resources/use-resource.js";

/**
 * The General tab: the channel's number and name, saved by the sheet
 * footer's **OK** or **Apply**; **OK** and **Cancel** close the window, as
 * an XP property sheet's did. Identity editing never exposes source or
 * scheduling policy. A number or name that differs from the channel's,
 * ignoring the spaces the server trims, counts as unsaved, so Cancel and
 * closing the window ask first.
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
  const closeWindow = useCloseWindow();
  const [number, setNumber] = useState(channel.number);
  const [name, setName] = useState(channel.name);
  // Whether Cancel is asking before it discards the fields.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const dirty =
    number.trim() !== channel.number || name.trim() !== channel.name;
  useUnsavedReport(dirty, onDirtyChange);
  // Sends the fields, then refreshes; OK closes the window once they saved.
  const save = (closing: boolean) =>
    void mutation.run(
      resourcePath("channels", channel.id),
      "PATCH",
      { number, name },
      () => {
        changed();
        if (closing) closeWindow();
      },
    );
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <fieldset disabled={mutation.pending}>
        <legend>Identity</legend>
        <div className="inline-form">
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
        </div>
      </fieldset>
      <RequestFeedback
        loading={mutation.pending}
        error={mutation.error}
        message={mutation.message}
      />
      <SheetFooter
        dirty={dirty}
        busy={mutation.pending}
        onOk={() => save(true)}
        onCancel={() => (dirty ? setConfirmingCancel(true) : closeWindow())}
        onApply={() => save(false)}
      />
      {confirmingCancel && (
        <UnsavedChangesDialog
          name={channel.name}
          onDiscard={closeWindow}
          onKeepEditing={() => setConfirmingCancel(false)}
        />
      )}
    </form>
  );
}
