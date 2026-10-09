import type { PathHints } from "./contracts.js";
import { classifyFolder } from "./folder-names.js";
import { parseName, type ParsedName } from "./parse-name.js";

// SxxEyy with an optional second episode: `s01e05-e06`, `s01e05e06`, `s01e05-06`.
// A bare second number has at most three digits, so `s01e05-1080` is no range.
const EPISODE =
  /(?<![\p{L}\p{N}])s(\d{1,4}) ?e(\d{1,4})(?:-?e(\d{1,4})|-(\d{1,3}))?(?![\p{L}\p{N}])/iu;

// A rip's track number in the spec's `t_01` or MakeMKV's `title_t03` form only,
// so names such as `T2` stay titles.
const TRACK = /(?:^t_|_t)(\d{1,3})$/iu;

// Filenames that name nothing, so the title comes from the folder instead.
const GENERIC_STEMS = new Set([
  "movie",
  "film",
  "feature",
  "main",
  "title",
  "video",
]);

/** What the folders between the media root and a file contribute. */
interface FolderHints {
  /** The nearest folder that names something; folders above it are ignored. */
  named?: ParsedName;
  season?: number;
  disc?: number;
  extra: boolean;
}

/**
 * Reads path hints from a file's folder and file names below its media root,
 * nearest folder first. Performs no I/O and never sees the root's own name, so
 * the root can never become a series or title.
 */
export function derivePathHints(segments: readonly string[]): PathHints {
  const folders = readFolders(segments.slice(0, -1));
  if (folders.extra) return { extra: true, strength: "weak" };

  const stem = stripExtension(segments.at(-1) ?? "");
  const spaced = stem.includes(" ") ? stem : stem.replace(/[._]/g, " ");
  const episode = EPISODE.exec(spaced);
  if (episode) return episodeHints(folders, spaced, episode);

  const track = TRACK.exec(stem);
  if (track) {
    return withFields(
      { extra: false, strength: "weak" },
      {
        series: folders.named?.name,
        year: folders.named?.year,
        season: folders.season,
        disc: folders.disc,
        track: Number(track[1]),
      },
    );
  }

  // A season folder with no episode number in the filename is episodic but
  // not identifiable, so it records the series and season only.
  if (folders.season !== undefined) {
    return withFields(
      { extra: false, strength: "weak" },
      {
        series: folders.named?.name,
        year: folders.named?.year,
        season: folders.season,
        disc: folders.disc,
      },
    );
  }
  return movieHints(folders, parseName(stem));
}

// Takes the name from the nearest folder that names something, and season and
// disc numbers from the folders between it and the file, nearest first. An
// extras folder counts only below a named folder: extras belong to something,
// while a top-level `Other/` merely organizes a library.
function readFolders(folders: readonly string[]): FolderHints {
  const roles = folders.map(classifyFolder);
  const outermost = roles.findIndex((role) => role.kind === "named");
  const hints: FolderHints = {
    extra:
      outermost !== -1 &&
      roles.some((role, index) => role.kind === "extras" && index > outermost),
  };
  for (const role of roles.toReversed()) {
    if (role.kind === "season") hints.season ??= role.season;
    else if (role.kind === "disc") hints.disc ??= role.disc;
    else if (role.kind === "named") {
      hints.named = role.named;
      hints.season ??= role.season;
      break;
    }
  }
  return hints;
}

// The filename's own text before SxxEyy names the series when present;
// otherwise the series comes from the nearest naming folder.
function episodeHints(
  folders: FolderHints,
  spaced: string,
  match: RegExpExecArray,
): PathHints {
  const first = Number(match[2]);
  const end = Number(match[3] ?? match[4] ?? first);
  const prefix = parseName(spaced.slice(0, match.index));
  const named = mergeWithFolder(
    prefix.name !== undefined ? prefix : undefined,
    folders.named,
  );
  return withFields(
    { extra: false, strength: named?.name !== undefined ? "strong" : "weak" },
    {
      series: named?.name,
      year: named?.year,
      season: Number(match[1]),
      episode: { first, last: end > first ? end : first },
      disc: folders.disc,
    },
  );
}

// A movie takes its title from the filename unless the filename is generic,
// then from the nearest naming folder. Any title is strong evidence.
function movieHints(folders: FolderHints, file: ParsedName): PathHints {
  const fromFile =
    file.name !== undefined && !GENERIC_STEMS.has(file.name.toLowerCase());
  const named = mergeWithFolder(fromFile ? file : undefined, folders.named);
  return withFields(
    { extra: false, strength: named?.name !== undefined ? "strong" : "weak" },
    { title: named?.name, year: named?.year, disc: folders.disc },
  );
}

// Uses the filename's name when it has one, else the folder's. When both
// name the same thing, as in `Alien (1979)/alien.mkv`, the folder's casing
// and either one's year are kept: folders are usually the better-named.
function mergeWithFolder(
  file: ParsedName | undefined,
  folder: ParsedName | undefined,
): ParsedName | undefined {
  if (file === undefined || folder === undefined) return file ?? folder;
  if (file.name?.toLowerCase() !== folder.name?.toLowerCase()) return file;
  const year = file.year ?? folder.year;
  return year === undefined ? { name: folder.name } : { ...folder, year };
}

// Copies only known fields, so an absent hint stays absent rather than undefined.
function withFields(
  base: PathHints,
  fields: Omit<PathHints, "extra" | "strength">,
): PathHints {
  const hints = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(hints, { [key]: value });
  }
  return hints;
}

// Drops the final extension; discovery only yields files that have one.
function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
