import type {
  HintedCandidate,
  LookupGroup,
  MetadataMatchRecord,
} from "../contracts.js";

/** A scan's lookup plan: extras to record as they are, and the searches to run. */
interface LookupPlan {
  extras: Extract<MetadataMatchRecord, { kind: "extra" }>[];
  groups: LookupGroup[];
}

/**
 * Plans a scan's lookups from its candidates' path hints, in discovery order.
 * An unsettled extra is recorded without a lookup. When `lookUp` is set,
 * each available unsettled movie joins the search for its title and year, and
 * each episode with a series, season, and episode joins the search for its
 * series folder, series name, and year, so one series search serves every
 * season folder beneath it. Anything else, such as a disc track, is skipped.
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
    const file = {
      pathKey: candidate.pathKey,
      hints,
      durationMs: candidate.durationMs,
    };
    const { series, seriesFolder, season, episode, title, year } = hints;
    if (
      series !== undefined &&
      seriesFolder !== undefined &&
      season !== undefined &&
      episode !== undefined
    ) {
      const key = searchKey(["series", seriesFolder, series, year]);
      const group = groups.get(key) ?? {
        kind: "series",
        hints: searchHints(series, year, hints.strength),
        files: [],
      };
      if (group.kind === "series") {
        group.files.push({ ...file, episode: { season, episode } });
      }
      groups.set(key, group);
    } else if (series === undefined && title !== undefined) {
      const key = searchKey(["movie", title, year]);
      const group = groups.get(key) ?? {
        kind: "movie",
        hints: searchHints(title, year, hints.strength),
        files: [],
      };
      if (group.kind === "movie") group.files.push(file);
      groups.set(key, group);
    }
  }
  return { extras, groups: [...groups.values()] };
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
