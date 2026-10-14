import type {
  OrderedMember,
  PlaybackMode,
  ScheduleMedia,
} from "./contracts.js";
import { hash32 } from "./seeded-hash.js";

/** Where a member falls in a metadata order, compared element by element. */
type SortKey = readonly (string | number)[];

// Ranks a missing month or day after every known one, so a less precise
// date follows the more precise dates it may include, and nothing is guessed.
const UNKNOWN_MONTH = 13;
const UNKNOWN_DAY = 32;

/**
 * Returns a collection's members in the order a playback mode plays them,
 * without changing the saved membership the members arrive in. Collection
 * order and random keep saved order; random picks among it by index alone.
 * Episode and release order place members by their metadata, then every
 * member that cannot be placed, in saved order. Ties keep saved order; saved
 * positions are unique, so that settles every tie.
 */
export function orderMembers(
  members: readonly ScheduleMedia[],
  playbackMode: PlaybackMode,
): readonly ScheduleMedia[] {
  const keyOf = metadataKeyFor(playbackMode);
  if (keyOf === null) return members;
  return members
    .map((media, savedIndex) => ({ media, savedIndex, key: keyOf(media) }))
    .sort((a, b) => {
      // Unplaceable members follow every placed one, in saved order.
      if (a.key === null || b.key === null) {
        if (a.key !== null) return -1;
        if (b.key !== null) return 1;
        return a.savedIndex - b.savedIndex;
      }
      return compareKeys(a.key, b.key) || a.savedIndex - b.savedIndex;
    })
    .map(({ media }) => media);
}

/**
 * Explains the order a playback mode plays, member by member, for the
 * preview: which members metadata could not place, where each series group
 * begins in episode order, and which members identify the same episode as
 * another. Duplicates stay selectable; they are flagged in every mode, since
 * they are a fact about the collection. Random has no ordered view.
 */
export function describeOrderedView(
  members: readonly ScheduleMedia[],
  playbackMode: PlaybackMode,
): OrderedMember[] | null {
  if (playbackMode === "random") return null;
  const keyOf = metadataKeyFor(playbackMode);
  const episodeCounts = new Map<string, number>();
  for (const media of members) {
    const key = episodeKey(media);
    if (key === null) continue;
    const id = JSON.stringify(key);
    episodeCounts.set(id, (episodeCounts.get(id) ?? 0) + 1);
  }
  let previousSeries: string | null = null;
  return orderMembers(members, playbackMode).map((media) => {
    const episode = episodeKey(media);
    const unresolved = keyOf !== null && keyOf(media) === null;
    const series =
      playbackMode === "episode" && !unresolved ? buildSeriesKey(media) : null;
    const startsSeriesGroup = series !== null && series !== previousSeries;
    if (series !== null) previousSeries = series;
    return {
      media,
      unresolved,
      startsSeriesGroup,
      duplicateEpisode:
        episode !== null &&
        (episodeCounts.get(JSON.stringify(episode)) ?? 0) > 1,
    };
  });
}

/** Returns how a metadata mode places a member, or null for a mode that keeps saved order. */
function metadataKeyFor(
  playbackMode: PlaybackMode,
): ((media: ScheduleMedia) => SortKey | null) | null {
  switch (playbackMode) {
    case "episode":
      return episodeKey;
    case "release":
      return releaseKey;
    default:
      return null;
  }
}

/**
 * Places a member in episode order when its series, season, and episode are
 * all known. A multi-episode file sorts at its first episode and airs once.
 */
function episodeKey(media: ScheduleMedia): SortKey | null {
  const seriesKey = buildSeriesKey(media);
  const { seasonNumber, episodeNumber } = media;
  return seriesKey === null || seasonNumber === null || episodeNumber === null
    ? null
    : [seriesKey, seasonNumber, episodeNumber];
}

/**
 * Builds the normalized series identity episode order groups by: the TMDB
 * series ID when there is one, else the series name compared without case
 * or surrounding and repeated whitespace. A name never joins a TMDB series,
 * since the owner may have renamed it away from that series on purpose.
 */
function buildSeriesKey(media: ScheduleMedia): string | null {
  if (media.seriesTmdbId !== null) return `tmdb:${media.seriesTmdbId}`;
  const name = media.seriesName?.trim().replace(/\s+/g, " ").toLowerCase();
  return name === undefined || name === "" ? null : `name:${name}`;
}

/**
 * Places a member in release order by year, then month, then day, reading
 * only the parts its date was stored with. Undated members cannot be placed.
 */
function releaseKey(media: ScheduleMedia): SortKey | null {
  if (media.releaseDate === null) return null;
  const [year = 0, month = UNKNOWN_MONTH, day = UNKNOWN_DAY] = media.releaseDate
    .split("-")
    .map(Number);
  return [year, month, day];
}

/**
 * Compares two keys of the same mode element by element. Text compares by
 * UTF-16 code units rather than locale, so the order never depends on the
 * host's locale settings.
 */
function compareKeys(a: SortKey, b: SortKey): number {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right || left === undefined || right === undefined) continue;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left) < String(right) ? -1 : 1;
  }
  return 0;
}

/**
 * Identifies the order a metadata mode plays, so a metadata write can be
 * checked for whether it changed that order. Two hashes of the ordered IDs
 * make an accidental match negligible. Every member counts, schedulable or
 * not, since the ordered view the preview shows lists them all; a reorder
 * among unschedulable members regenerates identical entries, which is safe.
 * Null for modes that keep saved order, since metadata never changes them.
 */
export function orderFingerprint(
  members: readonly ScheduleMedia[],
  playbackMode: PlaybackMode,
): string | null {
  if (metadataKeyFor(playbackMode) === null) return null;
  const ids = JSON.stringify(
    orderMembers(members, playbackMode).map((media) => media.id),
  );
  return [hash32(`order:a:${ids}`), hash32(`order:b:${ids}`)]
    .map((hash) => hash.toString(16).padStart(8, "0"))
    .join("");
}
