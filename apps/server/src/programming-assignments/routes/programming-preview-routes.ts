import type {
  GeneratedBlock,
  GeneratedScheduleEntry,
  RuleSkip,
} from "@krazitv/krazi-brain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { toApiTimestamp } from "../../http/api-timestamp.js";
import { idParams } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";

const MINUTE_MS = 60_000;

// How many turns a preview lists unless asked for fewer or more.
const DEFAULT_TURNS = 10;

const previewQuery = z.strictObject({
  turns: z.coerce.number().int().min(1).max(50).default(DEFAULT_TURNS),
});

/**
 * Registers the programming preview route: the turns a regeneration from
 * now would air, each with why it looks the way it does, and the
 * configuration revision it was generated from, so the editor can tell when
 * it is stale. Reads only.
 */
export function registerProgrammingPreviewRoutes(
  server: FastifyInstance,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/programming-preview", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = previewQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }
    const preview = await schedules.previewProgramming(id, request.log);
    switch (preview.kind) {
      case "channel_not_found":
        return sendChannelNotFound(reply, id);
      case "unschedulable":
        return sendApiError(
          reply,
          409,
          "channel_unschedulable",
          `Channel ${id} cannot generate a schedule`,
          { reason: preview.reason },
        );
    }
    const turns = [
      ...(preview.continuedTurn === undefined
        ? []
        : [{ block: preview.continuedTurn, continues: true }]),
      ...preview.blocks.map((block) => ({ block, continues: false })),
    ]
      .map(({ block, continues }) =>
        toApiTurn(
          block,
          preview.entries.filter(
            (entry) => entry.programmingBlockId === block.id,
          ),
          continues,
          preview.marathons.chancePercent,
          // A continued turn was decided earlier; what it passed over is not kept.
          continues
            ? null
            : preview.ruleSkips
                .filter((skip) => skip.blockId === block.id)
                .map(({ ruleId, reason }) => ({ ruleId, reason })),
        ),
      )
      .filter((turn) => turn.programs.length > 0)
      .slice(0, query.data.turns);
    return {
      configurationRevision: preview.configurationRevision,
      turns,
      skips: preview.skips.filter((skip) =>
        turns.some((turn) => turn.roundNumber === skip.roundNumber),
      ),
    };
  });
}

/**
 * Explains one turn: its member, the size it resolved and where its
 * settings came from, what it airs, and, for an airtime target the preview
 * starts, by how much whole programs ran over it. A marathon names the
 * channel chance that drew it. The rule that won when the turn was decided
 * and the rules passed over before it say why its source was eligible.
 */
function toApiTurn(
  block: GeneratedBlock,
  entries: readonly GeneratedScheduleEntry[],
  continues: boolean,
  marathonChancePercent: number,
  skippedRules: RuleSkip[] | null,
) {
  const airedMs = entries.reduce((total, entry) => total + entry.durationMs, 0);
  const first = entries[0];
  const last = entries.at(-1);
  return {
    assignmentId: block.assignmentId,
    member: block.source,
    roundNumber: block.roundNumber,
    turnIndex: block.turnIndex,
    continues,
    winningRuleId: block.winningRuleId,
    skippedRules,
    decidedAt: toApiTimestamp(block.startsAt),
    settingOrigins: block.settingOrigins,
    startsAt: first === undefined ? null : toApiTimestamp(first.startsAt),
    endsAt: last === undefined ? null : toApiTimestamp(last.endsAt),
    size: block.size,
    marathon: block.marathon,
    marathonChancePercent: block.marathon ? marathonChancePercent : null,
    airtimeMinutes: airedMs / MINUTE_MS,
    // A continued turn lists only what is left of it, so it has no overrun.
    overrunMinutes:
      block.size?.kind === "airtime" && !continues
        ? airedMs / MINUTE_MS - block.size.value
        : null,
    programs: entries.map((entry) => ({
      mediaItemId: entry.mediaItemId,
      title: entry.title,
      startsAt: toApiTimestamp(entry.startsAt),
      endsAt: toApiTimestamp(entry.endsAt),
    })),
  };
}
