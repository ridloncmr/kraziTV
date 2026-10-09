import { seriesEpisode, type PathHints } from "@krazitv/media";

import type { ReviewStep } from "../contracts.js";

/** One item that needs the owner's choice, as the review reads it. */
interface WaitingItem {
  id: string;
  rootId: string;
  /** The catalog's fallback title, for a step whose hints name nothing. */
  title: string;
  hints: PathHints;
}

/**
 * Turns the items needing a choice into Review matches steps, in the items'
 * order. Episodes sharing a series under one root are one step, because one
 * choice resolves them all; every other item is a step of its own. A disc
 * track is left out: mapping tracks to episodes resolves it, not a series
 * choice.
 */
export function groupReviewSteps(items: readonly WaitingItem[]): ReviewStep[] {
  const steps: ReviewStep[] = [];
  const bySeries = new Map<string, ReviewStep>();
  for (const { id, rootId, title, hints } of items) {
    if (hints.track !== undefined) continue;
    const shared = seriesEpisode(hints);
    if (shared === undefined) {
      steps.push({
        mediaItemId: id,
        title: hints.title ?? title,
        itemCount: 1,
      });
      continue;
    }
    const key = `${rootId}\u0000${shared.key}`;
    const step = bySeries.get(key);
    if (step !== undefined) {
      step.itemCount += 1;
      continue;
    }
    const first = { mediaItemId: id, title: shared.series, itemCount: 1 };
    bySeries.set(key, first);
    steps.push(first);
  }
  return steps;
}
