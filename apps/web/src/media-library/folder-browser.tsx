import { RequestFeedback } from "../controls/request-feedback.js";
import type { FolderListing } from "../http/contracts.js";
import { useResource } from "../http/use-resource.js";

/**
 * Browses the server's folders one level at a time. The caller owns which
 * folder is open, so opening a folder can also fill the caller's path field.
 * Paths come from the server because a browser cannot see server paths.
 */
export function FolderBrowser({
  path,
  disabled,
  onOpen,
}: {
  /** The open folder, or null for the server's top level. */
  path: string | null;
  disabled: boolean;
  onOpen: (path: string | null) => void;
}) {
  const listing = useResource<FolderListing>(
    path === null
      ? "/media-roots/folders"
      : `/media-roots/folders?${new URLSearchParams({ path })}`,
  );
  const { data } = listing;
  return (
    <div className="folder-browser" role="group" aria-label="Server folders">
      <div className="folder-browser-location">
        <button
          type="button"
          disabled={disabled || path === null || listing.loading}
          // A failed listing has no parent, so Up falls back to the top level.
          onClick={() => onOpen(data?.parent ?? null)}
        >
          Up
        </button>
        <span>{path ?? "This server"}</span>
      </div>
      <RequestFeedback loading={listing.loading} error={listing.error} />
      {data && data.folders.length === 0 && (
        <p className="secondary">No folders here.</p>
      )}
      {data && data.folders.length > 0 && (
        <ul className="folder-list">
          {data.folders.map((folder) => (
            <li key={folder.path}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(folder.path)}
              >
                {folder.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
