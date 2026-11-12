import { seriesEpisode, type PathHints } from "@krazitv/media";

import type { MetadataMatchRecord } from "../../content-metadata/contracts.js";
import type { HintedCandidate, LookupGroup } from "../contracts.js";
import { pathHintsBelow } from "../scanner/catalog-candidate.js";

/** A scan's lookup plan: extras to record as they are, and the searches to run. */
interface LookupPlan {
  extras: Extract<MetadataMatchRecord, { kind: "extra" }>[];
  groups: LookupGroup[];
}

/** The TMDB search a file's path hints call for. */
type Search =
  | { kind: "series"; shared: NonNullable<ReturnType<typeof seriesEpisode>> }
  | { kind: "movie"; title: string };

/**
 * Plans a scan's lookups from its candidates' path hints, in discovery order.
 * An unsettled extra is recorded without a lookup. When `lookUp` is set,
 * each available unsettled file joins the search its hints call for, so one
 * series search serves every season folder beneath its series folder.
 * Anything else, such as a disc track, is skipped.
 */
export function groupLookups(
  items: readonly HintedCandidate[],
  settled: ReadonlySet<string>,
  lookUp: boolean,
): LookupPlan {
  const extras: LookupPlan["extras"] = [];
  const groups = new Map<string, LookupGroup>();
  for (const { candidate, hints } of items) {
    if (hints === undefined || settled.has(candidate.pathKey)) continue;
    if (hints.extra) {
      extras.push({ kind: "extra", pathKey: candidate.pathKey, hints });
      continue;
    }
    if (!lookUp || candidate.status !== "available") continue;
    const search = searchFor(hints);
    if (search === undefined) continue;
    const file = {
      pathKey: candidate.pathKey,
      hints,
      durationMs: candidate.durationMs,
    };
    const { year } = hints;
    if (search.kind === "series") {
      const { shared } = search;
      const key = `series\u0000${shared.key}`;
      const group = groups.get(key) ?? {
        kind: "series",
        hints: searchHints(shared.series, year, hints.strength),
        files: [],
      };
      if (group.kind === "series") {
        const { season, episode } = shared;
        group.files.push({
          ...file,
          episode: season === undefined ? { episode } : { season, episode },
        });
      }
      groups.set(key, group);
    } else {
      const key = searchKey(["movie", search.title, year]);
      const group = groups.get(key) ?? {
        kind: "movie",
        hints: searchHints(search.title, year, hints.strength),
        files: [],
      };
      if (group.kind === "movie") group.files.push(file);
      groups.set(key, group);
    }
  }
  return { extras, groups: [...groups.values()] };
}

/**
 * Whether a lookup would search TMDB for the file at `path` below
 * `rootPath`. A scan or lookup retry never decides a file it does not search
 * for, such as a disc track before mapping, so the not-looked-up count and
 * the outstanding lookup retry take only files this accepts; otherwise such a
 * file would stay outstanding for good.
 */
export function wouldSearch(rootPath: string, path: string): boolean {
  const hints = pathHintsBelow(rootPath, path);
  return hints !== undefined && searchFor(hints) !== undefined;
}

// The search a file's hints call for: an episode with a series and episode
// number joins its series folder's search, and a title outside any series
// its movie's. An extra, a disc track, or a file naming no episode gets none.
function searchFor(hints: PathHints): Search | undefined {
  if (hints.extra) return undefined;
  const shared = seriesEpisode(hints);
  if (shared !== undefined) return { kind: "series", shared };
  if (hints.series === undefined && hints.title !== undefined) {
    return { kind: "movie", title: hints.title };
  }
  return undefined;
}

// Joins a search's identifying parts, ignoring a name's case.
function searchKey(parts: readonly (string | number | undefined)[]): string {
  return parts
    .map((part) =>
      typeof part === "string" ? part.toLowerCase() : (part ?? ""),
    )
    .join("\u0000");
}

// A search's hints, leaving an unknown year absent.
function searchHints(
  title: string,
  year: number | undefined,
  strength: LookupGroup["hints"]["strength"],
): LookupGroup["hints"] {
  return year === undefined ? { title, strength } : { title, year, strength };
}
