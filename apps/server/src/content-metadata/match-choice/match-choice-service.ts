import {
  lookUpEpisodesInSeries,
  lookUpMovieById,
  lookUpRuntimeMs,
  seriesEpisode,
  type EpisodeLookup,
  type MovieLookup,
  type TmdbClient,
} from "@krazitv/media";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../../database/schema/database-schema.js";
import { runImmediateTransaction } from "../../database/writes/immediate-transaction.js";
import { jsonIdList } from "../../database/writes/parameter-chunks.js";
import type {
  MatchCandidates,
  MatchChoiceRefusal,
  ReviewStep,
} from "../contracts.js";
import {
  deleteMatchRows,
  replaceMatchRows,
} from "../persistence/match-rows.js";
import { recordMatchedDuration } from "../persistence/matched-duration.js";
import type { TmdbKeyService } from "../tmdb-key/tmdb-key-service.js";
import {
  chosenRecord,
  readDecision,
  selectDecisions,
  type Waiting,
} from "./match-decision.js";
import { readMatchEvidence } from "./match-evidence.js";
import { groupReviewSteps } from "./review-steps.js";

/**
 * Applies the owner's match decisions: choosing a candidate, rejecting a
 * match, clearing a rejection, and keeping a match whose file changed. TMDB
 * is asked before any write, never
 * inside one (ADR 0013), so every write re-reads the items it changes under
 * write authority and changes only those still in the state it read.
 */
export class MatchChoiceService {
  readonly #db: Kysely<DatabaseSchema>;
  readonly #tmdbKeys: Pick<TmdbKeyService, "readKey">;
  readonly #tmdb: TmdbClient;
  readonly #now: () => number;

  // Shares the server's one TMDB client, so choices queue with scan lookups
  // under TMDB's rate ceiling.
  constructor(
    db: Kysely<DatabaseSchema>,
    tmdbKeys: Pick<TmdbKeyService, "readKey">,
    tmdb: TmdbClient,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#tmdbKeys = tmdbKeys;
    this.#tmdb = tmdb;
    this.#now = now;
  }

  /**
   * Lists the ambiguous items as Review matches steps, in catalog order.
   * Steps are read when the dialog opens; a choice may settle a later step
   * before it shows, which its candidate read then reports.
   */
  async reviewSteps(): Promise<ReviewStep[]> {
    const rows = await selectDecisions(this.#db)
      .innerJoin("media_roots", "media_roots.id", "media_items.media_root_id")
      .select("media_items.title")
      .where("metadata_matches.state", "=", "ambiguous")
      .orderBy("media_roots.path_key")
      .orderBy("media_items.path_key")
      .execute();
    return groupReviewSteps(
      rows.map((row) => ({
        id: row.id,
        rootId: row.rootId,
        title: row.title,
        hints: readMatchEvidence(row.evidence).hints,
      })),
    );
  }

  /**
   * Reads an ambiguous item's stored candidates beside its probed duration.
   * It asks TMDB nothing, so opening a choice costs no calls; each runtime is
   * read on request through `runtime`.
   */
  async candidates(
    mediaItemId: string,
  ): Promise<MatchCandidates | MatchChoiceRefusal> {
    const waiting = await this.#readWaiting(mediaItemId);
    if ("kind" in waiting) return waiting;
    const rows = await this.#db
      .selectFrom("metadata_match_candidates")
      .selectAll()
      .where("media_item_id", "=", mediaItemId)
      .orderBy("position")
      .execute();
    return {
      kind: seriesEpisode(waiting.hints) === undefined ? "movie" : "series",
      durationMs: waiting.durationMs,
      candidates: rows.map((row) => ({
        tmdbId: row.tmdb_id,
        title: row.title,
        releaseDate: row.release_date,
        posterPath: row.poster_path,
      })),
    };
  }

  /**
   * Asks TMDB for one offered candidate's runtime, for this file's movie or
   * episodes, so the owner pays one call per runtime they want to compare.
   * Null when TMDB does not know it or the lookup fails.
   */
  async runtime(
    mediaItemId: string,
    tmdbId: number,
  ): Promise<
    { kind: "runtime"; runtimeMs: number | null } | MatchChoiceRefusal
  > {
    const apiKey = await this.#tmdbKeys.readKey();
    if (apiKey === undefined) return { kind: "tmdb_key_missing" };
    const offered = await this.#readOffered(mediaItemId, tmdbId);
    if ("kind" in offered) return offered;
    const place = seriesEpisode(offered.hints);
    const runtimeMs = await lookUpRuntimeMs(
      this.#tmdb,
      apiKey,
      place === undefined
        ? { kind: "movie", id: tmdbId }
        : { kind: "series", id: tmdbId, episode: place },
    );
    return { kind: "runtime", runtimeMs: runtimeMs ?? null };
  }

  /**
   * Accepts one of an ambiguous item's candidates. For an episode, the chosen
   * series also resolves every other ambiguous episode sharing its series
   * folder whose episode the series holds; the rest stay ambiguous. Commits
   * only to items still cataloged and with the same ambiguous decision after
   * the TMDB reads.
   */
  async choose(
    mediaItemId: string,
    tmdbId: number,
  ): Promise<{ kind: "chosen"; resolvedCount: number } | MatchChoiceRefusal> {
    const apiKey = await this.#tmdbKeys.readKey();
    if (apiKey === undefined) return { kind: "tmdb_key_missing" };
    const chosen = await this.#readOffered(mediaItemId, tmdbId);
    if ("kind" in chosen) return chosen;

    const lookups = await this.#lookUpChoice(apiKey, chosen, tmdbId);
    const own = lookups.find(({ item }) => item.id === mediaItemId)?.lookup;
    if (own?.kind === "failed") {
      return { kind: "lookup_failed", reason: own.reason };
    }
    if (own?.kind !== "matched") return { kind: "episode_not_in_series" };

    const lookedUpAt = this.#now();
    const matched = lookups.filter(({ lookup }) => lookup.kind === "matched");
    // When each item was last looked up, as read before TMDB answered.
    const readAt = new Map(
      matched.map(({ item }) => [item.id, item.lookedUpAt]),
    );
    const records = matched.map(({ item, lookup }) => ({
      id: item.id,
      record: chosenRecord(item, lookup, lookedUpAt),
    }));
    return runImmediateTransaction(this.#db, async (pinned) => {
      const rows = await selectDecisions(pinned)
        .where("media_items.id", "in", jsonIdList(records.map(({ id }) => id)))
        .where("metadata_matches.state", "=", "ambiguous")
        .execute();
      // A decision looked up again meanwhile may offer other candidates, so
      // only one unchanged since the read takes the choice.
      const still = new Set(
        rows
          .filter((row) => row.lookedUpAt === readAt.get(row.id))
          .map((row) => row.id),
      );
      if (!still.has(mediaItemId)) {
        return (await readDecision(pinned, mediaItemId)) === undefined
          ? { kind: "item_not_found" as const }
          : { kind: "not_ambiguous" as const };
      }
      const writable = records.filter(({ id }) => still.has(id));
      await replaceMatchRows(pinned, writable);
      return { kind: "chosen" as const, resolvedCount: writable.length };
    });
  }

  /**
   * Rejects an item's match or its candidates, dropping any accepted facts.
   * The rejection applies only to this file and holds on rescans, since a
   * scan never looks up a rejected item again.
   */
  async reject(
    mediaItemId: string,
  ): Promise<{ kind: "rejected" } | MatchChoiceRefusal> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const decision = await readDecision(pinned, mediaItemId);
      if (decision === undefined) return { kind: "item_not_found" as const };
      if (
        decision.extra ||
        (decision.state !== "ambiguous" && decision.state !== "matched")
      ) {
        return { kind: "not_rejectable" as const };
      }
      await deleteMatchRows(pinned, [mediaItemId]);
      await pinned
        .insertInto("metadata_matches")
        .values({
          media_item_id: mediaItemId,
          state: "rejected",
          extra: 0,
          lookup_error: null,
          looked_up_at: decision.lookedUpAt,
          evidence: decision.evidence,
          matched_duration_ms: null,
        })
        .execute();
      return { kind: "rejected" as const };
    });
  }

  /**
   * Clears a rejection, leaving the item never looked up, so the next scan
   * or retry looks it up afresh.
   */
  async clearRejection(
    mediaItemId: string,
  ): Promise<{ kind: "cleared" } | MatchChoiceRefusal> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const decision = await readDecision(pinned, mediaItemId);
      if (decision === undefined) return { kind: "item_not_found" as const };
      if (decision.state !== "rejected") {
        return { kind: "not_rejected" as const };
      }
      await deleteMatchRows(pinned, [mediaItemId]);
      return { kind: "cleared" as const };
    });
  }

  /**
   * Keeps a match the owner reviewed after its file changed, taking the
   * file's current duration as its match-time duration, which clears the
   * changed-file flag. Refused unless the item is still matched, so a
   * delayed request never revives a match rejected or replaced meanwhile.
   */
  async keepMatch(
    mediaItemId: string,
  ): Promise<{ kind: "kept" } | MatchChoiceRefusal> {
    return runImmediateTransaction(this.#db, async (pinned) => {
      const decision = await readDecision(pinned, mediaItemId);
      if (decision === undefined) return { kind: "item_not_found" as const };
      if (decision.state !== "matched") return { kind: "not_matched" as const };
      await recordMatchedDuration(pinned, mediaItemId);
      return { kind: "kept" as const };
    });
  }

  /**
   * Reads the chosen candidate's facts for the chosen item and, for an
   * episode, for every ambiguous episode sharing its series folder, each
   * paired with its own lookup.
   */
  async #lookUpChoice(
    apiKey: string,
    chosen: Waiting,
    tmdbId: number,
  ): Promise<{ item: Waiting; lookup: MovieLookup | EpisodeLookup }[]> {
    const place = seriesEpisode(chosen.hints);
    if (place === undefined) {
      const lookup = await lookUpMovieById(
        this.#tmdb,
        apiKey,
        tmdbId,
        chosen.query,
      );
      return [{ item: chosen, lookup }];
    }
    const rows = await selectDecisions(this.#db)
      .where("media_items.media_root_id", "=", chosen.rootId)
      .where("metadata_matches.state", "=", "ambiguous")
      .execute();
    const siblings = rows.flatMap((row) => {
      const item = { ...row, extra: false, ...readMatchEvidence(row.evidence) };
      const shared = seriesEpisode(item.hints);
      return shared?.key === place.key ? [{ item, shared }] : [];
    });
    const lookups = await lookUpEpisodesInSeries(
      this.#tmdb,
      apiKey,
      tmdbId,
      chosen.query,
      siblings.map(({ shared }) => shared),
    );
    return siblings.flatMap(({ item }, index) => {
      const lookup = lookups[index];
      return lookup === undefined ? [] : [{ item, lookup }];
    });
  }

  /**
   * Reads an item that needs a choice and offers `tmdbId`, or why not, so
   * TMDB is only ever asked about a candidate the item's lookup found.
   */
  async #readOffered(
    mediaItemId: string,
    tmdbId: number,
  ): Promise<Waiting | MatchChoiceRefusal> {
    const waiting = await this.#readWaiting(mediaItemId);
    if ("kind" in waiting) return waiting;
    const offered = await this.#db
      .selectFrom("metadata_match_candidates")
      .select("tmdb_id")
      .where("media_item_id", "=", mediaItemId)
      .where("tmdb_id", "=", tmdbId)
      .executeTakeFirst();
    return offered === undefined ? { kind: "candidate_not_offered" } : waiting;
  }

  /** Reads an item that needs a choice, or why it does not. */
  async #readWaiting(
    mediaItemId: string,
  ): Promise<Waiting | MatchChoiceRefusal> {
    const decision = await readDecision(this.#db, mediaItemId);
    if (decision === undefined) return { kind: "item_not_found" };
    if (decision.state !== "ambiguous") return { kind: "not_ambiguous" };
    return { ...decision, ...readMatchEvidence(decision.evidence) };
  }
}
