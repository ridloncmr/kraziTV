import { parseName, type ParsedName } from "./parse-name.js";

// The spec's built-in folder list. It is fixed in code, not user-configurable:
// a missed generic name costs one user resolution per folder, and new names
// join these tables. Names match the whole folder name, ignoring case.

/** What a folder contributes to path hints. */
type FolderRole =
  | { kind: "season"; season: number }
  | { kind: "disc"; disc: number }
  | { kind: "extras" }
  | { kind: "skipped" }
  | { kind: "named"; named: ParsedName & { name: string }; season?: number };

const SEASON_WORDS = [
  "season",
  "series",
  "staffel",
  "saison",
  "temporada",
  "stagione",
  "seizoen",
  "säsong",
  "sæson",
  "sezon",
  "kausi",
  "сезон",
  "シーズン",
  "시즌",
];

// A season word with a number, or S1 / S01. A bare number never matches,
// because titles such as `24` and `1923` collide with it.
const SEASON = `(?:(?:${SEASON_WORDS.join("|")})[ ._-]*|s)(\\d+)`;
const SEASON_FOLDER = new RegExp(`^${SEASON}$`, "iu");

// A series name ending in its season, as in `Firefly Season 1` or `Firefly S01`.
const TRAILING_SEASON = new RegExp(`^(.+?)[ ._-]+${SEASON}$`, "iu");

const DISC_FOLDER = /^(?:disc|disk|dvd|cd)[ ._-]*(\d+)$/iu;

const EXTRAS_FOLDERS = new Set([
  "trailers",
  "behind the scenes",
  "deleted scenes",
  "featurettes",
  "interviews",
  "scenes",
  "shorts",
  "clips",
  "sample",
  "samples",
  "extra",
  "extras",
  "other",
]);

const SKIPPED_FOLDERS = new Set([
  // Disc structure
  "video_ts",
  "audio_ts",
  "bdmv",
  "stream",
  "playlist",
  "certificate",
  // Quality split
  "4k",
  "uhd",
  "hd",
  "sd",
  "720p",
  "1080p",
  "2160p",
  "remux",
  // Catch-all
  "tv",
  "tv shows",
  "shows",
  "series",
  "movies",
  "films",
  "video",
  "videos",
  "media",
  "library",
  "downloads",
  "anime",
  "cartoons",
  "kids",
  "documentaries",
  "recorded tv",
  "recordings",
  "dvr",
  "unsorted",
  "incoming",
  "completed",
  "new folder",
  "plex",
  "jellyfin",
]);

/**
 * Classifies one folder name against the built-in folder list, first as
 * written and then with release tokens and year removed, so `Season 1 (2002)`
 * is still a season folder. A folder of nothing but release tokens names
 * nothing and is skipped.
 */
export function classifyFolder(folder: string): FolderRole {
  const listed = classifyListed(folder);
  if (listed !== undefined) return listed;
  const parsed = parseName(folder);
  if (parsed.name === undefined) return { kind: "skipped" };
  const cleaned = classifyListed(parsed.name);
  if (cleaned !== undefined) return cleaned;

  const trailing = TRAILING_SEASON.exec(parsed.name);
  return trailing
    ? {
        kind: "named",
        named: { ...parsed, name: trailing[1] },
        season: Number(trailing[2]),
      }
    : { kind: "named", named: { ...parsed, name: parsed.name } };
}

// Matches a whole name against the folder list, or undefined when it names something.
function classifyListed(name: string): FolderRole | undefined {
  const key = name.toLowerCase();
  if (key === "specials") return { kind: "season", season: 0 };
  const season = SEASON_FOLDER.exec(name);
  if (season) return { kind: "season", season: Number(season[1]) };
  const disc = DISC_FOLDER.exec(name);
  if (disc) return { kind: "disc", disc: Number(disc[1]) };
  if (EXTRAS_FOLDERS.has(key)) return { kind: "extras" };
  if (SKIPPED_FOLDERS.has(key)) return { kind: "skipped" };
  return undefined;
}
