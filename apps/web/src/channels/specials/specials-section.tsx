import { useState } from "react";
import { displayTime } from "../../controls/display-time.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { resourcePath } from "../../http/api-client.js";
import type { MediaCollection } from "../../http/contracts/collections.js";
import { useMutation, useResource } from "../../http/use-resource.js";
import { PLAYBACK_MODE_CHOICES } from "../assignments/playback-mode-choices.js";
import type { Special } from "./contracts.js";
import { EndEarlyDialog } from "./end-early-dialog.js";
import { SpecialEditor } from "./special-editor.js";

/**
 * Lists the channel's specials with when they air and what they air, and
 * lets the owner add one, edit or cancel one that has not started, or end
 * one that is running early. Each accepted write refreshes the list; the
 * server regenerates around it.
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
  const cancel = useMutation();
  const [editing, setEditing] = useState<string>();
  const [ending, setEnding] = useState<Special>();
  // Closes the editor and reads the list again after any accepted write.
  const changed = () => {
    setEditing(undefined);
    specials.refresh();
  };
  // Says what a special airs, in the words the editor uses.
  const describe = (special: Special) => {
    const { source } = special;
    if (source.kind === "media_items") {
      const count = source.mediaItemIds.length;
      return `${count} ${count === 1 ? "media item" : "media items"} in order`;
    }
    const name =
      collections.data?.find(
        (collection) => collection.id === source.mediaCollectionId,
      )?.name ?? source.mediaCollectionId;
    const mode =
      PLAYBACK_MODE_CHOICES.find(
        (choice) => choice.mode === source.playbackMode,
      )?.label ?? source.playbackMode;
    return `${name}, ${mode.toLowerCase()}`;
  };
  const listed = specials.data ?? [];
  return (
    <section aria-label="Specials">
      <h3>Specials</h3>
      <RequestFeedback
        loading={specials.loading || cancel.pending}
        error={cancel.error ?? specials.error}
      />
      {specials.data?.length === 0 && (
        <p className="empty-state">
          No specials. A special airs chosen programming at an exact time.
        </p>
      )}
      <ul aria-label="Channel specials">
        {listed.map((special) => {
          // The server says where each special stands, so a skewed browser
          // clock never offers an edit the server would refuse.
          const started = special.status !== "upcoming";
          const running = special.status === "running";
          return (
            <li key={special.id}>
              {editing === special.id ? (
                <SpecialEditor
                  channelId={channelId}
                  special={special}
                  collections={collections.data}
                  visible={visible}
                  saved={changed}
                  onClose={() => setEditing(undefined)}
                />
              ) : (
                <div className="inline-form">
                  <span>
                    {displayTime(special.startsAt)} –{" "}
                    {displayTime(special.endsAt)} · {describe(special)}
                    {running ? " · On air" : started && " · Ended"}
                  </span>
                  {running && (
                    <button type="button" onClick={() => setEnding(special)}>
                      End early…
                    </button>
                  )}
                  {!started && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(special.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={cancel.pending}
                        onClick={() =>
                          void cancel.run(
                            `${path}/${encodeURIComponent(special.id)}`,
                            "DELETE",
                            undefined,
                            changed,
                          )
                        }
                      >
                        Cancel special
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {ending && (
        <EndEarlyDialog
          special={ending}
          path={`${path}/${encodeURIComponent(ending.id)}`}
          ended={changed}
          onClose={() => setEnding(undefined)}
        />
      )}
      {editing === "new" ? (
        <SpecialEditor
          channelId={channelId}
          collections={collections.data}
          visible={visible}
          saved={changed}
          onClose={() => setEditing(undefined)}
        />
      ) : (
        <button type="button" onClick={() => setEditing("new")}>
          Add a special
        </button>
      )}
    </section>
  );
}
