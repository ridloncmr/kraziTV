import type { TmdbClient } from "../tmdb/tmdb-client.js";
import { placeEpisodes, type EpisodeHints } from "./episode-placement.js";

/** A candidate whose runtime is wanted: a movie, or a series and the file's episodes in it. */
type RuntimeSubject =
  | { kind: "movie"; id: number }
  | { kind: "series"; id: number; episode: EpisodeHints };

/**
 * Reads a candidate's TMDB runtime, so the owner can compare it with the
 * file's probed duration. A multi-episode file's runtime is the sum of its
 * episodes', placed in the series as a lookup places one file. Undefined when TMDB does
 * not know it or the lookup fails: the runtime only helps a choice and is
 * never evidence for a match.
 */
export async function lookUpRuntimeMs(
  client: TmdbClient,
  apiKey: string,
  subject: RuntimeSubject,
  signal?: AbortSignal,
): Promise<number | undefined> {
  if (subject.kind === "movie") {
    const details = await client.movieDetails(apiKey, subject.id, signal);
    return details.kind === "ok" ? details.value.runtimeMs : undefined;
  }
  const series = await client.seriesDetails(apiKey, subject.id, signal);
  if (series.kind === "failed") return undefined;
  // One file alone never counts through the series: a lone number past a
  // season's end is a numbering disagreement, as the lookup reads it.
  const [place] = placeEpisodes(series.value.seasons, [subject.episode], false);
  if (place === undefined) return undefined;
  const fetched = await client.seasonDetails(
    apiKey,
    subject.id,
    place.season,
    signal,
  );
  if (fetched.kind === "failed") return undefined;
  let total = 0;
  for (let n = place.episode.first; n <= place.episode.last; n += 1) {
    const runtimeMs = fetched.value.episodes.find(
      (known) => known.number === n,
    )?.runtimeMs;
    if (runtimeMs === undefined) return undefined;
    total += runtimeMs;
  }
  return total;
}
