import { findCalendarProblem, RULE_BEHAVIORS } from "@krazitv/krazi-brain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../channels/repository/channel-repository.js";
import {
  sendApiError,
  sendChannelNotFound,
  sendInvalidRequest,
} from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams, nameField, stretchField } from "../http/request-schemas.js";
import type { ScheduleService } from "../schedules/schedule-service.js";
import type { RuleSourceRefusal, SavedRule } from "./contracts.js";
import { ruleChange } from "./rule-change.js";
import type { RuleRepository } from "./rule-repository.js";

// Date shapes only; kraziBrain's calendar rule decides which values are valid.
const dates = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("any") }),
  z.strictObject({
    kind: z.literal("one_off"),
    startDate: z.string(),
    endDate: z.string(),
  }),
  z.strictObject({
    kind: z.literal("annual"),
    startMonthDay: z.string(),
    endMonthDay: z.string(),
  }),
]);

// A selected assignment, inheriting its settings unless the body overrides them.
const ruleSource = z.strictObject({
  assignmentId: z.string(),
  ordinaryStretch: stretchField.nullable().default(null),
  marathon: z
    .discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("inherit") }),
      z.strictObject({ mode: z.literal("disabled") }),
      z.strictObject({ mode: z.literal("replace"), stretch: stretchField }),
    ])
    .default({ mode: "inherit" }),
});

// Create and PATCH share one body: PATCH replaces the whole rule, sources in
// saved order. Omitted conditions are unrestricted. Each source appears once.
const ruleBody = z
  .strictObject({
    name: nameField,
    behavior: z.enum(RULE_BEHAVIORS),
    priority: z.number().int(),
    dates: dates.default({ kind: "any" }),
    // No weekdays, like none named, means every day.
    weekdays: z
      .array(z.number())
      .nullable()
      .default(null)
      .transform((days) => (days?.length === 0 ? null : days)),
    window: z
      .strictObject({ startMinute: z.number(), endMinute: z.number() })
      .nullable()
      .default(null),
    sources: z
      .array(ruleSource)
      .min(1)
      .refine(
        (sources) =>
          new Set(sources.map(({ assignmentId }) => assignmentId)).size ===
          sources.length,
        { message: "sources must not repeat an assignment" },
      ),
  })
  .superRefine((body, context) => {
    const problem = findCalendarProblem(body);
    if (problem !== null) {
      context.addIssue({ code: "custom", message: problem });
    }
  });

const ruleParams = idParams.extend({ ruleId: z.string() });

const orderBody = z.strictObject({ ruleIds: z.array(z.string()) });

/** Registers programming rule HTTP routes; validation and status mapping live only here. */
export function registerRuleRoutes(
  server: FastifyInstance,
  rules: RuleRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
): void {
  // The editor shows where rule conditions are evaluated; the browser's
  // own timezone never decides them.
  server.get("/programming-timezone", async () => ({
    programmingTimezone: schedules.programmingTimezone(),
  }));

  server.get("/channels/:id/programming-rules", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // The repository lists nothing for an unknown channel; the API says so instead.
    if ((await channels.findById(id)) === undefined) {
      return sendChannelNotFound(reply, id);
    }
    return (await rules.listForChannel(id)).map(toApiRule);
  });

  server.post("/channels/:id/programming-rules", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = ruleBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await schedules.applyInputChange(
      request.log,
      "rule_created",
      ruleChange(id, "created", schedules.programmingTimezone(), (trx, now) =>
        rules.create(trx, id, body.data, now),
      ),
    );
    switch (result.kind) {
      case "created":
        return reply.status(201).send(toApiRule(result.rule));
      case "channel_not_found":
        return sendChannelNotFound(reply, id);
      default:
        return sendSourceRefusal(reply, result);
    }
  });

  server.patch(
    "/channels/:id/programming-rules/:ruleId",
    async (request, reply) => {
      const { id, ruleId } = ruleParams.parse(request.params);
      const body = ruleBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      // Unchanged settings affect no channel, so nothing regenerates.
      const result = await schedules.applyInputChange(
        request.log,
        "rule_changed",
        ruleChange(id, "updated", schedules.programmingTimezone(), (trx, now) =>
          rules.update(trx, id, ruleId, body.data, now),
        ),
      );
      switch (result.kind) {
        case "updated":
        case "unchanged":
          return toApiRule(result.rule);
        case "not_found":
          return sendRuleNotFound(reply, id, ruleId);
        default:
          return sendSourceRefusal(reply, result);
      }
    },
  );

  // Saves the order that breaks priority ties among the channel's rules.
  server.put(
    "/channels/:id/programming-rules/order",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = orderBody.safeParse(request.body);
      if (!body.success) {
        return sendInvalidRequest(reply, body.error);
      }
      const result = await schedules.applyInputChange(
        request.log,
        "rules_reordered",
        ruleChange(
          id,
          "reordered",
          schedules.programmingTimezone(),
          (trx, now) => rules.reorder(trx, id, body.data.ruleIds, now),
        ),
      );
      switch (result.kind) {
        case "reordered":
        case "unchanged":
          return result.rules.map(toApiRule);
        case "channel_not_found":
          return sendChannelNotFound(reply, id);
        default:
          return sendApiError(
            reply,
            409,
            "programming_rule_order_mismatch",
            `The order must name each of channel ${id}'s rules once`,
            { ruleIds: result.ruleIds },
          );
      }
    },
  );

  server.delete(
    "/channels/:id/programming-rules/:ruleId",
    async (request, reply) => {
      const { id, ruleId } = ruleParams.parse(request.params);
      const result = await schedules.applyInputChange(
        request.log,
        "rule_deleted",
        ruleChange(id, "deleted", schedules.programmingTimezone(), (trx) =>
          rules.delete(trx, id, ruleId),
        ),
      );
      if (result.kind === "not_found") {
        return sendRuleNotFound(reply, id, ruleId);
      }
      return reply.status(204).send();
    },
  );
}

// A rule owned by another channel is reported the same as a missing one.
function sendRuleNotFound(
  reply: FastifyReply,
  channelId: string,
  ruleId: string,
) {
  return sendApiError(
    reply,
    404,
    "programming_rule_not_found",
    `Channel ${channelId} has no programming rule ${ruleId}`,
  );
}

// A body's unknown reference is a 400, not a 404: the rule itself exists.
// An invalid effective stretch pair names the source and kraziBrain's reason.
function sendSourceRefusal(reply: FastifyReply, result: RuleSourceRefusal) {
  if (result.kind === "invalid_stretch") {
    return sendApiError(
      reply,
      400,
      "programming_rule_stretch_invalid",
      `Rule settings for programming assignment ${result.assignmentId} are invalid: ${result.problem}`,
      { assignmentId: result.assignmentId, problem: result.problem },
    );
  }
  return sendApiError(
    reply,
    400,
    "programming_assignment_not_found",
    `This channel has no programming assignment ${result.assignmentId}`,
    { assignmentId: result.assignmentId },
  );
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
function toApiRule(rule: SavedRule) {
  return {
    id: rule.id,
    channelId: rule.channelId,
    name: rule.name,
    behavior: rule.behavior,
    priority: rule.priority,
    dates: rule.dates,
    weekdays: rule.weekdays,
    window: rule.window,
    sources: rule.sources,
    createdAt: toApiTimestamp(rule.createdAt),
    updatedAt: toApiTimestamp(rule.updatedAt),
  };
}
