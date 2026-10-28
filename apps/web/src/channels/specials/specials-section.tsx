import { useState } from "react";
import { displayClockTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { rowClickProps, rowOpenProps } from "../../controls/row-click.js";
import { RowMenu } from "../../controls/row-menu.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { useMutation, useResource } from "../../http/resources/use-resource.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import { listNames } from "../lineup/show-labels.js";
import { useMemberNames } from "../lineup/use-member-names.js";
import type { Special } from "./contracts.js";
import { EndEarlyDialog } from "./end-early-dialog.js";
import { SpecialEditor } from "./special-editor.js";

// Where a special stands, in the words its Status column shows.
const STATUS_WORDS: Record<Special["status"], string> = {
  upcoming: "Upcoming",
  running: "On air",
  ended: "Ended",
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * The Specials tab: the channel's specials as a list saying when each airs,
 * what it airs, and where it stands. **New special…** and **Edit…** open
 * the special editor; a special that has not started can be edited or
 * cancelled after a confirmation, and one on air can only end early. The
 * server says where each stands, so a skewed browser clock never offers a
 * change the server would refuse. Each accepted write refreshes the list;
 * the server regenerates around it.
 */
export function SpecialsSection({
  channelId,
  visible,
}: {
  channelId: string;
  visible: boolean;
}) {
  const path = `${resourcePath("channels", channelId)}/reservations`;
  const specials = useResource<Special[]>(path, visible);
  const collections = useResource<MediaCollection[]>(
    "/media-collections",
    visible,
  );
  const listed = specials.data ?? [];
  const itemName = useMemberNames(
    listed.flatMap(({ source }) =>
      source.kind === "media_items"
        ? source.mediaItemIds.map((mediaItemId) => ({
            kind: "media_item" as const,
            mediaItemId,
          }))
        : [],
    ),
    collections.data,
    visible,
  );
  const cancel = useMutation();
  const [selectedId, setSelectedId] = useState<string>();
  // The special open in the editor, `new` for a new one, or nothing.
  const [editing, setEditing] = useState<string>();
  const [cancelling, setCancelling] = useState<Special>();
  const [ending, setEnding] = useState<Special>();
  const selected = listed.find((special) => special.id === selectedId);
  const edited = listed.find((special) => special.id === editing);
  // Closes any dialog and reads the list again after an accepted write.
  const changed = () => {
    setEditing(undefined);
    setCancelling(undefined);
    specials.refresh();
  };
  // Says what a special airs: its programs by title, or its collection and order.
  const describe = (special: Special) => {
    const { source } = special;
    if (source.kind === "media_items") {
      return listNames(
        source.mediaItemIds.map((mediaItemId) =>
          itemName({ kind: "media_item", mediaItemId }),
        ),
      );
    }
    const name = itemName({
      kind: "collection",
      mediaCollectionId: source.mediaCollectionId,
    });
    const mode =
      PLAYBACK_MODE_CHOICES.find(
        (choice) => choice.mode === source.playbackMode,
      )?.label ?? source.playbackMode;
    return `${name} · ${mode}`;
  };
  // The changes a special takes where it stands, for its row menu and the toolbar.
  const actions = (special: Special | undefined) => [
    {
      label: "Edit…",
      disabled: special?.status !== "upcoming",
      onSelect: () => setEditing(special?.id),
    },
    {
      label: "Cancel special…",
      disabled: special?.status !== "upcoming",
      onSelect: () => setCancelling(special),
    },
    {
      label: "End early…",
      disabled: special?.status !== "running",
      onSelect: () => setEnding(special),
    },
  ];
  // Opens an upcoming special in the editor, as a double-click or Enter does.
  const open = (special: Special) => {
    setSelectedId(special.id);
    if (special.status === "upcoming") setEditing(special.id);
  };
  return (
    <section aria-label="Specials">
      <p className="secondary">
        A special airs chosen programming at an exact time. The lineup stops for
        it and picks up again afterward.
      </p>
      <RequestFeedback
        loading={specials.loading}
        error={specials.error ?? collections.error}
      />
      {specials.data?.length === 0 && (
        <p className="empty-state">No specials scheduled.</p>
      )}
      {listed.length > 0 && (
        <div className="table-scroll">
          <table aria-label="Channel specials">
            <thead>
              <tr>
                <th>When</th>
                <th>What airs</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {listed.map((special) => (
                <tr
                  key={special.id}
                  className={`clickable-row${special.id === selectedId ? " selected-row" : ""}`}
                  {...rowClickProps(() => setSelectedId(special.id))}
                  {...rowOpenProps(() => open(special))}
                >
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setSelectedId(special.id)}
                    >
                      {airtimeWords(special)}
                    </button>
                  </td>
                  <td>{describe(special)}</td>
                  <td>{STATUS_WORDS[special.status]}</td>
                  <td>
                    <RowMenu
                      label={`Actions for the special at ${airtimeWords(special)}`}
                      items={actions(special)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {specials.data && (
        <div className="row-actions">
          <button type="button" onClick={() => setEditing("new")}>
            New special…
          </button>
          {actions(selected).map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {(editing === "new" || edited) && (
        <SpecialEditor
          key={editing}
          channelId={channelId}
          special={edited}
          collections={collections.data}
          visible={visible}
          saved={changed}
          onClose={() => setEditing(undefined)}
        />
      )}
      {cancelling && (
        <WindowDialog
          title="Cancel special"
          busy={cancel.pending}
          onClose={() => setCancelling(undefined)}
        >
          <p>
            Cancel the special at <strong>{airtimeWords(cancelling)}</strong>?
            The lineup plays in its place.
          </p>
          <RequestFeedback loading={cancel.pending} error={cancel.error} />
          <div className="dialog-actions">
            <button
              type="button"
              disabled={cancel.pending}
              onClick={() =>
                void cancel.run(
                  `${path}/${encodeURIComponent(cancelling.id)}`,
                  "DELETE",
                  undefined,
                  changed,
                )
              }
            >
              Cancel special
            </button>
            <button
              type="button"
              disabled={cancel.pending}
              onClick={() => setCancelling(undefined)}
            >
              Keep it
            </button>
          </div>
        </WindowDialog>
      )}
      {ending && (
        <EndEarlyDialog
          special={ending}
          path={`${path}/${encodeURIComponent(ending.id)}`}
          ended={changed}
          onClose={() => setEnding(undefined)}
        />
      )}
    </section>
  );
}

/**
 * Says when a special airs, such as `Sat, Oct 24 · 8:00 PM – 10:00 PM`,
 * naming the end's date too when it falls on another day.
 */
function airtimeWords(special: Special): string {
  const startDate = dateFormat.format(new Date(special.startsAt));
  const endDate = dateFormat.format(new Date(special.endsAt));
  const endClock = displayClockTime(special.endsAt);
  return `${startDate} · ${displayClockTime(special.startsAt)} – ${startDate === endDate ? "" : `${endDate} `}${endClock}`;
}
