import type { FolderTrack, ProposalRow } from "../contracts.js";

// A play-all track runs within this share of its disc's other tracks' total;
// rips round each title, so an exact sum never happens.
const PLAY_ALL_TOLERANCE = 0.05;

// A track shorter than this share of the folder's median track is an extra
// or a menu loop, not an episode.
const SHORT_SHARE = 1 / 3;

/**
 * Orders tracks as the proposal numbers them: disc by disc, then by track,
 * and by file name where those tie. A track outside any disc folder sorts as
 * disc 0, so a folder without disc folders orders by track then name.
 */
export function compareTracks(a: FolderTrack, b: FolderTrack): number {
  return (
    (a.disc ?? 0) - (b.disc ?? 0) ||
    a.track - b.track ||
    a.path.localeCompare(b.path)
  );
}

/**
 * Proposes which of a season's episodes each track holds, for the owner to
 * edit before anything is stored. Takes tracks in `compareTracks` order and
 * episodes in TMDB's order. Short tracks and play-all tracks start skipped;
 * the rest take the season's episodes in turn across discs, and tracks left
 * after the last episode start skipped. Runtime never decides a row: rips
 * of the same episode differ, and the owner confirms every row.
 */
export function proposeTrackMapping(
  tracks: readonly FolderTrack[],
  episodeNumbers: readonly number[],
): ProposalRow[] {
  const short = shortTracks(tracks);
  const playAll = playAllTracks(tracks, short);
  let next = 0;
  return tracks.map(({ mediaItemId }) => {
    if (short.has(mediaItemId) || playAll.has(mediaItemId)) {
      return { mediaItemId, episodeNumber: null };
    }
    const episodeNumber = episodeNumbers[next] ?? null;
    next += 1;
    return { mediaItemId, episodeNumber };
  });
}

// The tracks shorter than a third of the folder's median known duration.
function shortTracks(tracks: readonly FolderTrack[]): Set<string> {
  const durations = known(tracks)
    .map(({ durationMs }) => durationMs)
    .sort((a, b) => a - b);
  // The two middle values, which are one value for an odd count.
  const lower = durations[Math.ceil(durations.length / 2) - 1] ?? 0;
  const upper = durations[Math.floor(durations.length / 2)] ?? 0;
  const median = (lower + upper) / 2;
  return new Set(
    known(tracks)
      .filter(({ durationMs }) => durationMs < median * SHORT_SHARE)
      .map(({ mediaItemId }) => mediaItemId),
  );
}

// The tracks whose duration is close to the total of at least two other
// tracks on the same disc. Short tracks are left out of that total, since a
// play-all title holds the episodes, not the extras beside them.
function playAllTracks(
  tracks: readonly FolderTrack[],
  short: ReadonlySet<string>,
): Set<string> {
  const playAll = new Set<string>();
  const counted = known(tracks).filter(
    ({ mediaItemId }) => !short.has(mediaItemId),
  );
  for (const track of counted) {
    const others = counted.filter(
      (other) =>
        other.mediaItemId !== track.mediaItemId &&
        (other.disc ?? 0) === (track.disc ?? 0),
    );
    if (others.length < 2) continue;
    const total = others.reduce((sum, other) => sum + other.durationMs, 0);
    if (Math.abs(track.durationMs - total) <= total * PLAY_ALL_TOLERANCE) {
      playAll.add(track.mediaItemId);
    }
  }
  return playAll;
}

// The tracks with a probed duration; a probe-failed track decides nothing.
function known(tracks: readonly FolderTrack[]) {
  return tracks.filter(
    (track): track is FolderTrack & { durationMs: number } =>
      track.durationMs !== null,
  );
}
