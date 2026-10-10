import { formText } from "../../controls/form-text.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type {
  CorrectableField,
  ContentMetadata,
  MediaItem,
} from "../../http/contracts.js";
import { useMutation } from "../../http/use-resource.js";

// The correctable fields in form order, with their labels and input types.
const FIELDS: [CorrectableField, string, "text" | "number"][] = [
  ["title", "Title", "text"],
  ["seriesName", "Series", "text"],
  ["seasonNumber", "Season", "number"],
  ["episodeNumber", "Episode", "number"],
];

/**
 * Corrects an item's title, series, season, and episode, and edits its tags.
 * Fields start at what the item shows; only changed fields are sent, and a
 * field emptied clears its correction so TMDB's value shows again. Works
 * without TMDB, since corrections are then the only way to set facts.
 */
export function CorrectDetailsDialog({
  item,
  onCorrected,
  onClose,
}: {
  item: MediaItem;
  /** The server committed the change; `corrected` is the item as now shown. */
  onCorrected: (corrected: MediaItem) => void;
  onClose: () => void;
}) {
  const { metadata } = item;
  const mutation = useMutation();
  return (
    <WindowDialog
      title="Correct details"
      busy={mutation.pending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const change = correctionChange(
            metadata,
            new FormData(event.currentTarget),
          );
          if (Object.keys(change).length === 0) return onClose();
          void mutation.run(
            resourcePath("metadata/corrections", item.id),
            "PATCH",
            change,
            onCorrected,
          );
        }}
      >
        <p>
          {item.title}
          <small className="secondary path-cell">{item.path}</small>
        </p>
        <fieldset disabled={mutation.pending}>
          <legend>Details</legend>
          <div className="inline-form">
            {FIELDS.map(([field, label, type]) => (
              <label key={field}>
                {label}
                <input
                  name={field}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                  step={type === "number" ? 1 : undefined}
                  defaultValue={metadata[field] ?? ""}
                />
              </label>
            ))}
            <label>
              Tags
              <input
                name="tags"
                defaultValue={metadata.tags.join(", ")}
                placeholder="space western, heist"
              />
            </label>
          </div>
          <p className="secondary">
            Leave a field empty to use TMDB&apos;s value. Separate tags with
            commas.
          </p>
        </fieldset>
        <RequestFeedback loading={mutation.pending} error={mutation.error} />
        <div className="dialog-actions">
          <button type="submit" disabled={mutation.pending}>
            Save
          </button>
          <button type="button" disabled={mutation.pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </WindowDialog>
  );
}

/**
 * The change a submitted form asks for: each field whose text differs from
 * what the item shows, null when emptied, and the tags when their list
 * differs. The server trims tags and keeps each once.
 */
function correctionChange(
  metadata: ContentMetadata,
  values: FormData,
): Record<string, unknown> {
  const change: Record<string, unknown> = {};
  for (const [field, , type] of FIELDS) {
    const text = formText(values, field).trim();
    if (text === String(metadata[field] ?? "")) continue;
    change[field] =
      text === "" ? null : type === "number" ? Number(text) : text;
  }
  const tags = formText(values, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  if (tags.join("\n") !== metadata.tags.join("\n")) change.tags = tags;
  return change;
}
