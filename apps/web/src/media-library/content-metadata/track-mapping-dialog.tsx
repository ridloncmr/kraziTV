import { useState } from "react";
import { TmdbAttribution } from "../../branding/tmdb-attribution.js";
import { displayDuration } from "../../controls/display-duration.js";
import { formText } from "../../controls/form-text.js";
import { RequestFeedback } from "../../controls/request-feedback.js";
import { WindowDialog } from "../../controls/window-dialog.js";
import { resourcePath } from "../../http/api-client.js";
import type {
  SeriesSearch,
  TrackFolder,
  TrackProposal,
} from "../../http/contracts.js";
import { useMutation, useResource } from "../../http/use-resource.js";

/** The series and season the owner proposes a mapping from. */
interface SeasonChoice {
  tmdbSeriesId: number;
  title: string;
  season: number;
}

/**
 * Maps a folder of disc tracks to one TMDB season's episodes. The owner
 * searches for the series, starting from the folder's name, picks it and a
 * season, and edits the server's proposal row by row, each track's duration
 * beside its episode's runtime. Nothing is stored before **Apply**, which
 * sends every row at once; **Cancel** sends nothing.
 */
export function TrackMappingDialog({
  mediaItemId,
  onApplied,
  onClose,
}: {
  /** The disc-track file the dialog was opened from. */
  mediaItemId: string;
  /** The mapping committed; the listed items are now stale. */
  onApplied: () => void;
  onClose: () => void;
}) {
  const mapping = resourcePath("metadata/track-mappings", mediaItemId);
  const folder = useResource<TrackFolder>(mapping);
  const [searched, setSearched] = useState<string>();
  const search = useResource<SeriesSearch>(
    searched === undefined
      ? null
      : `/metadata/series-search?${new URLSearchParams({ query: searched }).toString()}`,
  );
  const [series, setSeries] = useState<{ tmdbId: number; title: string }>();
  const [choice, setChoice] = useState<SeasonChoice>();
  const proposal = useResource<TrackProposal>(
    choice === undefined
      ? null
      : `${mapping}/proposal?${new URLSearchParams({
          tmdbSeriesId: String(choice.tmdbSeriesId),
          season: String(choice.season),
        }).toString()}`,
  );
  // The owner's row edits by track; an absent track keeps the proposal's.
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  const apply = useMutation();
  const pending = apply.pending;
  const tracks = folder.data?.tracks ?? [];
  const episodeOf = (id: string) =>
    id in edits
      ? (edits[id] ?? null)
      : (proposal.data?.rows.find((row) => row.mediaItemId === id)
          ?.episodeNumber ?? null);
  return (
    <WindowDialog
      title="Map tracks to episodes"
      busy={pending}
      onClose={onClose}
    >
      <RequestFeedback
        loading={
          folder.loading || search.loading || proposal.loading || pending
        }
        error={apply.error ?? proposal.error ?? search.error ?? folder.error}
      />
      {folder.data && !proposal.data && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const season = Number(formText(values, "season"));
            if (series !== undefined && Number.isInteger(season)) {
              setEdits({});
              setChoice({
                tmdbSeriesId: series.tmdbId,
                title: series.title,
                season,
              });
            }
          }}
        >
          <p>
            {tracks.length} disc {tracks.length === 1 ? "track" : "tracks"} to
            map.
          </p>
          <div className="inline-form">
            <label>
              Series
              <input
                name="query"
                defaultValue={folder.data.series ?? ""}
                disabled={pending}
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={(event) => {
                const query = formText(
                  new FormData(event.currentTarget.form ?? undefined),
                  "query",
                ).trim();
                if (query !== "") setSearched(query);
              }}
            >
              Search TMDB
            </button>
            <label>
              Season
              <input
                name="season"
                type="number"
                min={0}
                step={1}
                defaultValue={folder.data.season ?? 1}
                disabled={pending}
              />
            </label>
          </div>
          {search.data && (
            <ul className="match-candidates">
              {search.data.candidates.length === 0 && (
                <li>TMDB found no series by that name.</li>
              )}
              {search.data.candidates.map((candidate) => {
                const name = `${candidate.title} (${candidate.releaseDate?.slice(0, 4) ?? "year unknown"})`;
                return (
                  <li key={candidate.tmdbId}>
                    <label>
                      <input
                        type="radio"
                        name="series"
                        checked={series?.tmdbId === candidate.tmdbId}
                        onChange={() =>
                          setSeries({ tmdbId: candidate.tmdbId, title: name })
                        }
                      />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {search.data && <TmdbAttribution />}
          <div className="dialog-actions">
            <button type="submit" disabled={pending || series === undefined}>
              Next
            </button>
            <button type="button" disabled={pending} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {proposal.data && choice && (
        <>
          <p>
            {choice.title}, season {choice.season}. Choose each track&apos;s
            episode, or Skip to keep it as an extra.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Duration</th>
                  <th>Episode</th>
                  <th>TMDB runtime</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => {
                  const label =
                    track.disc === null
                      ? `Track ${track.track}`
                      : `Disc ${track.disc} Track ${track.track}`;
                  const number = episodeOf(track.mediaItemId);
                  const runtimeMs =
                    proposal.data?.episodes.find(
                      (episode) => episode.number === number,
                    )?.runtimeMs ?? null;
                  return (
                    <tr key={track.mediaItemId}>
                      <td>
                        {label}
                        <small className="secondary path-cell">
                          {track.path}
                        </small>
                      </td>
                      <td>{displayDuration(track.durationMs)}</td>
                      <td>
                        <select
                          aria-label={`Episode for ${label}`}
                          value={number ?? ""}
                          disabled={pending}
                          onChange={(event) =>
                            setEdits({
                              ...edits,
                              [track.mediaItemId]:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        >
                          <option value="">Skip</option>
                          {proposal.data?.episodes.map((episode) => (
                            <option key={episode.number} value={episode.number}>
                              E{episode.number}
                              {episode.title ? ` – ${episode.title}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {number === null ? "—" : displayDuration(runtimeMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TmdbAttribution />
          <div className="dialog-actions">
            <button
              disabled={pending}
              onClick={() =>
                void apply.run(
                  mapping,
                  "POST",
                  {
                    tmdbSeriesId: choice.tmdbSeriesId,
                    season: choice.season,
                    rows: tracks.map((track) => ({
                      mediaItemId: track.mediaItemId,
                      episodeNumber: episodeOf(track.mediaItemId),
                    })),
                  },
                  onApplied,
                )
              }
            >
              Apply
            </button>
            <button disabled={pending} onClick={() => setChoice(undefined)}>
              Back
            </button>
            <button disabled={pending} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </WindowDialog>
  );
}
