import type { CalendarConditions } from "../calendar/contracts.js";
import type {
  GeneratedBlock,
  LatestTurn,
  ProgrammingAssignment,
  ProgrammingRule,
  RuleSource,
} from "../krazi-plan/contracts.js";
import {
  generateProgramming,
  type GenerateProgrammingOptions,
} from "../krazi-plan/generate-programming.js";
import { progressKey } from "../schedule/regeneration.js";
import type {
  CollectionProgress,
  GeneratedScheduleEntry,
  PlaybackMode,
  ScheduleMedia,
} from "../schedule/contracts.js";

/**
 * Builds an assignment of one collection with a program-count stretch,
 * unless a test overrides it, so each test states only what it is about.
 */
export function collectionAssignment(
  id: string,
  mediaCollectionId: string,
  members: readonly ScheduleMedia[],
  overrides: Partial<Omit<ProgrammingAssignment, "id" | "members">> & {
    playbackMode?: PlaybackMode;
  } = {},
): ProgrammingAssignment {
  return {
    id,
    participation: "default",
    playbackMode: "chronological",
    ordinary: { kind: "programs", count: 3 },
    marathon: null,
    members: [{ kind: "collection", mediaCollectionId, members }],
    ...overrides,
  };
}

/** Builds an assignment whose only member is one single media item. */
export function itemAssignment(
  id: string,
  media: ScheduleMedia,
): ProgrammingAssignment {
  return {
    id,
    participation: "default",
    playbackMode: null,
    ordinary: { kind: "programs", count: 3 },
    marathon: null,
    members: [{ kind: "media_item", media }],
  };
}

/**
 * Builds a join rule selecting `sources` that applies everywhere, unless a
 * test narrows its conditions or changes its behavior or precedence. A
 * source named by ID alone inherits its assignment's settings.
 */
export function programmingRule(
  id: string,
  sources: readonly (string | RuleSource)[],
  {
    conditions = {},
    ...overrides
  }: Partial<Omit<ProgrammingRule, "id" | "sources" | "conditions">> & {
    conditions?: Partial<CalendarConditions>;
  } = {},
): ProgrammingRule {
  return {
    id,
    behavior: "join",
    priority: 0,
    ruleOrder: 0,
    conditions: {
      dates: { kind: "any" },
      weekdays: null,
      window: null,
      ...conditions,
    },
    sources: sources.map((source) =>
      typeof source === "string"
        ? {
            assignmentId: source,
            ordinary: null,
            marathon: { mode: "inherit" },
          }
        : source,
    ),
    ...overrides,
  };
}

/** Returns block IDs `block-1`, `block-2`, ... so tests can name them. */
export function sequentialBlockIds(prefix = "block"): () => string {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

/** Everything a run of generation wrote, as the server would hold it. */
export interface PersistedProgramming {
  blocks: GeneratedBlock[];
  entries: GeneratedScheduleEntry[];
  progress: CollectionProgress[];
}

/**
 * Generates through `through` in chunks of at most `chunkSize` entries,
 * feeding each chunk the latest block, its aired totals, and the progress
 * the previous chunks wrote, exactly as the server persists and reloads
 * them. Equal results for different chunk sizes prove chunking changes
 * nothing.
 */
export function generateInChunks(
  options: Omit<
    GenerateProgrammingOptions,
    "latestTurn" | "progress" | "nextSequenceNumber" | "maxEntries"
  >,
  chunkSize: number,
  from: PersistedProgramming = { blocks: [], entries: [], progress: [] },
): PersistedProgramming {
  const persisted: PersistedProgramming = {
    blocks: [...from.blocks],
    entries: [...from.entries],
    progress: [...from.progress],
  };
  let startsAt = options.startsAt;
  for (;;) {
    const result = generateProgramming({
      ...options,
      startsAt,
      latestTurn: latestTurn(persisted),
      progress: persisted.progress,
      nextSequenceNumber: persisted.entries.length,
      maxEntries: chunkSize,
    });
    if (result.kind !== "generated") {
      throw new Error(`expected generated, got ${result.reason}`);
    }
    persisted.blocks.push(...result.blocks);
    persisted.entries.push(...result.entries);
    for (const written of result.progress) {
      const key = progressKey(written.mediaCollectionId, written.playbackMode);
      persisted.progress = [
        ...persisted.progress.filter(
          (kept) =>
            progressKey(kept.mediaCollectionId, kept.playbackMode) !== key,
        ),
        written,
      ];
    }
    startsAt = result.generatedThrough;
    if (startsAt >= options.through || result.entries.length === 0) {
      // Rows have no order in storage; key order keeps runs comparable.
      persisted.progress.sort((a, b) =>
        progressKey(a.mediaCollectionId, a.playbackMode).localeCompare(
          progressKey(b.mediaCollectionId, b.playbackMode),
        ),
      );
      return persisted;
    }
  }
}

/** The latest persisted block with what its turn aired, as the server loads it. */
export function latestTurn({
  blocks,
  entries,
}: Pick<PersistedProgramming, "blocks" | "entries">): LatestTurn | undefined {
  const block = blocks.at(-1);
  if (block === undefined) return undefined;
  const aired = entries.filter(
    (entry) => entry.programmingBlockId === block.id,
  );
  return {
    block,
    airedPrograms: aired.length,
    airedMs: aired.reduce((total, entry) => total + entry.durationMs, 0),
  };
}
