import type { PathHints } from "./contracts.js";
import { classifyFolder } from "./folder-names.js";
import { parseName, type ParsedName } from "./parse-name.js";
import { normalizeTitle } from "../titles/normalize-title.js";

// SxxEyy with an optional second episode: `s01e05-e06`, `s01e05e06`,
// `s01e05-06`; `EP` for `E`; a segment letter or two, as `s03e04a` and
// `s01e01ab`, ignored. A bare second number has at most three digits, so
// `s01e05-1080` is no range.
const EPISODE =
  /(?<![\p{L}\p{N}])s(\d{1,4})[ ._-]?(?:ep|e)(\d{1,4})(?:[ ._-]?(?:ep|e)(\d{1,4})|-(\d{1,3}))?(?:[a-d]{1,2})?(?![\p{L}\p{N}])/iu;

// The `7x03` form: a short season, so `1920x1080` is no episode.
const SEASON_X_EPISODE =
  /(?<![\p{L}\p{N}])(\d{1,2})x(\d{1,3})(?![\p{L}\p{N}])/iu;

// `Episode 04` or `Ep 04` without a season: numbered by the folder's season
// when it has one, else absolutely through the whole series.
const NUMBERED_EPISODE =
  /(?<![\p{L}\p{N}])(?:episode|ep)[ ._]*(\d{1,4})(?![\p{L}\p{N}])/iu;

// `SS016`: a special, which TMDB keeps in season 0.
const SPECIAL = /(?<![\p{L}\p{N}])ss(\d{1,4})(?![\p{L}\p{N}])/iu;

// A bare number ending the name, as `Bleach 64`: an episode only under a
// season folder, where a file that is no disc track can be nothing else, so
// `Apollo 13` and `Oceans 11` stay titles.
const TRAILING_NUMBER = /(?<=\S\s+)(\d{1,4})$/u;

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
  /**
   * The outermost folder that names something: a show's own folder, which
   * holds its season folders. Folders between it and the file only add a
   * season or disc.
   */
  outermost?: ParsedName;
  /** That folder's path below the media root, `/`-joined. */
  outermostPath?: string;
  /** The innermost folder that names something, which a movie file sits in. */
  nearest?: ParsedName;
  season?: number;
  disc?: number;
  extra: boolean;
}

/** An episode number read from a filename, with its season when written there. */
interface EpisodeCode {
  season?: number;
  episode: { first: number; last: number };
  /** Where the code starts; the text before it may name the series. */
  index: number;
}

/**
 * Reads path hints from a file's folder and file names below its media root.
 * Performs no I/O and never sees the root's own name, so the root can never
 * become a series or title.
 */
export function derivePathHints(segments: readonly string[]): PathHints {
  const folderNames = segments.slice(0, -1);
  const folders = readFolders(folderNames);
  if (folders.extra) return { extra: true, strength: "weak" };

  const stem = stripExtension(segments.at(-1) ?? "");
  const spaced = stem.includes(" ") ? stem : stem.replace(/[._]/g, " ");
  const fileFolder = folderNames.join("/");
  const code = episodeCode(spaced);
  if (code) return episodeHints(folders, fileFolder, spaced, code);

  // A track's series folder groups it with the other discs of its rip, so
  // the owner can map them to episodes together.
  const track = TRACK.exec(stem);
  if (track) {
    return withFields(
      { extra: false, strength: "weak" },
      {
        series: folders.outermost?.name,
        seriesFolder: folders.outermostPath ?? folderNames.join("/"),
        year: folders.outermost?.year,
        season: folders.season,
        disc: folders.disc,
        track: Number(track[1]),
      },
    );
  }

  // Under a season folder a bare trailing number is the episode, since the
  // file can be nothing else; without one the file is episodic but not
  // identifiable, so it records the series and season only.
  if (folders.season !== undefined) {
    const trailing = TRAILING_NUMBER.exec(spaced);
    if (trailing) {
      const number = Number(trailing[1]);
      return episodeHints(folders, fileFolder, spaced, {
        episode: { first: number, last: number },
        index: trailing.index,
      });
    }
    return withFields(
      { extra: false, strength: "weak" },
      {
        series: folders.outermost?.name,
        year: folders.outermost?.year,
        season: folders.season,
        disc: folders.disc,
      },
    );
  }
  return movieHints(folders, parseName(stem));
}

// Reads the outermost and nearest naming folders, and the nearest season and
// disc numbers from any folder. An extras folder counts only below a named
// folder: extras belong to something, while a top-level `Other/` merely
// organizes a library.
function readFolders(folders: readonly string[]): FolderHints {
  const roles = folders.map(classifyFolder);
  const outermost = roles.findIndex((role) => role.kind === "named");
  const hints: FolderHints = {
    extra:
      outermost !== -1 &&
      roles.some((role, index) => role.kind === "extras" && index > outermost),
  };
  for (let index = roles.length - 1; index >= 0; index -= 1) {
    const role = roles[index];
    if (role?.kind === "season") hints.season ??= role.season;
    else if (role?.kind === "disc") hints.disc ??= role.disc;
    else if (role?.kind === "named") {
      hints.nearest ??= role.named;
      hints.season ??= role.season;
      if (index === outermost) {
        hints.outermost = role.named;
        hints.outermostPath = folders.slice(0, index + 1).join("/");
      }
    }
  }
  return hints;
}

// Reads a filename's episode code in any of the forms kraziTV knows, or
// undefined when it has none.
function episodeCode(spaced: string): EpisodeCode | undefined {
  const coded = EPISODE.exec(spaced) ?? SEASON_X_EPISODE.exec(spaced);
  if (coded) {
    const season = Number(coded[1]);
    const first = Number(coded[2]);
    const end = Number(coded[3] ?? coded[4] ?? first);
    return {
      season,
      episode: { first, last: end > first ? end : first },
      index: coded.index,
    };
  }
  const special = SPECIAL.exec(spaced);
  if (special) {
    const number = Number(special[1]);
    return {
      season: 0,
      episode: { first: number, last: number },
      index: special.index,
    };
  }
  const numbered = NUMBERED_EPISODE.exec(spaced);
  if (numbered) {
    const number = Number(numbered[1]);
    return { episode: { first: number, last: number }, index: numbered.index };
  }
  return undefined;
}

// The series folder names the series, with its year and country, when the
// filename agrees with it: the filename names nothing before its episode
// code, or names the folder's series or a longer name that contains it, as
// `Survivorman and Son - S05E06` under `Survivorman/`. A filename naming
// something else is a loose file in a mixed folder, so its own name and
// year win, as `Firefly.S01E05` under `Random Stuff/`. Either way the
// series folder is the outermost naming folder, so every season beneath it
// shares one lookup. Without one, the file's own folder is the series folder.
function episodeHints(
  folders: FolderHints,
  fileFolder: string,
  spaced: string,
  code: EpisodeCode,
): PathHints {
  const prefix = parseName(spaced.slice(0, code.index));
  const folder = folders.outermost;
  const named =
    prefix.name === undefined || (folder && namesWithin(folder, prefix))
      ? folder
      : prefix;
  return withFields(
    { extra: false, strength: named?.name !== undefined ? "strong" : "weak" },
    {
      series: named?.name,
      seriesFolder:
        named?.name === undefined
          ? undefined
          : (folders.outermostPath ?? fileFolder),
      year: named?.year,
      country: named?.country,
      season: code.season ?? folders.season,
      episode: code.episode,
      disc: folders.disc,
    },
  );
}

// True when the folder's name is the filename's series name, or part of it,
// ignoring case and punctuation.
function namesWithin(folder: ParsedName, prefix: ParsedName): boolean {
  if (folder.name === undefined || prefix.name === undefined) return false;
  return ` ${normalizeTitle(prefix.name)} `.includes(
    ` ${normalizeTitle(folder.name)} `,
  );
}

// A movie takes its title from the filename unless the filename is generic,
// then from the nearest naming folder. Any title is strong evidence.
function movieHints(folders: FolderHints, file: ParsedName): PathHints {
  const fromFile =
    file.name !== undefined && !GENERIC_STEMS.has(file.name.toLowerCase());
  const named = mergeWithFolder(fromFile ? file : undefined, folders.nearest);
  return withFields(
    { extra: false, strength: named?.name !== undefined ? "strong" : "weak" },
    { title: named?.name, year: named?.year, disc: folders.disc },
  );
}

// Uses the filename's name when it has one, else the folder's. When both
// name the same thing, as in `Alien (1979)/alien.mkv` or the scene-style
// `Alien (1979)/Alien.1979.mkv`, the folder's casing and either one's year
// are kept: folders are usually the better-named.
function mergeWithFolder(
  file: ParsedName | undefined,
  folder: ParsedName | undefined,
): ParsedName | undefined {
  if (file === undefined || folder === undefined) return file ?? folder;
  const fileName = file.name?.toLowerCase();
  const folderName = folder.name?.toLowerCase();
  if (fileName === `${folderName} ${folder.year}`) return folder;
  if (fileName !== folderName) return file;
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
