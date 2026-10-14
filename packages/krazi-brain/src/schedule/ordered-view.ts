import type { PlaybackMode, ScheduleMedia } from "./contracts.js";

/** Where one member falls in episode order, or null when it cannot be placed. */
interface EpisodePlace {
  seriesKey: string;
  seasonNumber: number;
  episodeNumber: number;
}

/**
 * Returns a collection's members in the order a playback mode plays them,
 * without changing the saved membership the members arrive in.
 * Collection order and random keep saved order; random picks among it by
 * index alone. Episode order places identified episodes first by series
 * key, season, and episode, then every unplaceable member in saved order.
 * Ties keep saved order; saved positions are unique, so that settles every
 * tie.
 */
export function orderMembers(
  members: readonly ScheduleMedia[],
  playbackMode: PlaybackMode,
): readonly ScheduleMedia[] {
  if (playbackMode !== "episode") return members;
  const placed = members.map((media, savedIndex) => ({
    media,
    savedIndex,
    place: episodePlace(media),
  }));
  return placed
    .sort((a, b) => {
      // Unplaceable members follow every placed one, in saved order.
      if (a.place === null || b.place === null) {
        if (a.place !== null) return -1;
        if (b.place !== null) return 1;
        return a.savedIndex - b.savedIndex;
      }
      return (
        compareText(a.place.seriesKey, b.place.seriesKey) ||
        a.place.seasonNumber - b.place.seasonNumber ||
        a.place.episodeNumber - b.place.episodeNumber ||
        a.savedIndex - b.savedIndex
      );
    })
    .map(({ media }) => media);
}

/**
 * Places a member in episode order when its series, season, and episode are
 * all known. A multi-episode file sorts at its first episode and airs once.
 */
function episodePlace(media: ScheduleMedia): EpisodePlace | null {
  const seriesKey = buildSeriesKey(media);
  const { seasonNumber, episodeNumber } = media;
  return seriesKey === null || seasonNumber === null || episodeNumber === null
    ? null
    : { seriesKey, seasonNumber, episodeNumber };
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
 * Compares by UTF-16 code units rather than locale, so the order never
 * depends on the host's locale settings.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
