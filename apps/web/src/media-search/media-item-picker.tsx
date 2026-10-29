import { useState } from "react";
import { displayCount } from "../controls/formatting/display-count.js";
import { RequestFeedback } from "../controls/dialogs/request-feedback.js";
import { resourcePath } from "../http/api-client.js";
import type { MediaItem } from "../http/contracts/media.js";
import { useResource } from "../http/resources/use-resource.js";
import { AVAILABILITY_LABELS } from "../media-availability/availability-label.js";
import { useMediaItemPage } from "./use-media-item-page.js";

const RESULT_LIMIT = 25;

/**
 * Chooses one catalog item through server-side search, so the choices never
 * hold the whole catalog. The chosen item stays listed after the search
 * moves past it, loaded by ID when no result contains it.
 */
export function MediaItemPicker({
  label,
  value,
  exclude = [],
  visible,
  onChange,
}: {
  label: string;
  value: string;
  exclude?: readonly string[];
  visible: boolean;
  onChange: (item: MediaItem | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const results = useMediaItemPage(search, RESULT_LIMIT, visible);
  const found = results.data?.items.find((item) => item.id === value);
  // Also loads while a new search is pending, so the choice never blanks out.
  const chosen = useResource<MediaItem>(
    value && !found ? resourcePath("media-items", value) : null,
    visible,
  );
  const selected = found ?? chosen.data;
  const options = (results.data?.items ?? []).filter(
    (item) => item.id === value || !exclude.includes(item.id),
  );
  if (selected && !options.includes(selected)) options.unshift(selected);
  const hidden = (results.data?.total ?? 0) - (results.data?.items.length ?? 0);
  return (
    <>
      <label>
        Find media
        <input
          type="search"
          value={search}
          placeholder="Title or path"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <label>
        {label}
        <select
          value={value}
          onChange={(event) =>
            onChange(options.find((item) => item.id === event.target.value))
          }
        >
          <option value="">Choose media</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.status === "available"
                ? item.title
                : `${item.title} (${AVAILABILITY_LABELS[item.status]})`}
            </option>
          ))}
        </select>
        {hidden > 0 && (
          <small className="secondary">
            {displayCount(hidden)} more matches. Refine the search to narrow
            them.
          </small>
        )}
      </label>
      <RequestFeedback error={results.error ?? chosen.error} />
    </>
  );
}
