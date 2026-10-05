import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  sendApiError,
  sendChannelDisabled,
  sendChannelNotFound,
  sendInvalidRequest,
  sendThroughOutOfRange,
} from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import {
  idParams,
  isoInstantField,
  windowQuery,
} from "../http/request-schemas.js";
import type {
  EnsureCoverageResult,
  ScheduleEntry,
  ScheduleWindow,
} from "./contracts.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "./schedule-coverage.js";
import type { ScheduleService } from "./schedule-service.js";

const scheduleWindowQuery = windowQuery(SCHEDULE_REQUEST_LIMIT_MS);

// `regenerate` rebuilds from the boundary instead of only extending.
const generateBody = z.strictObject({
  through: isoInstantField.optional(),
  regenerate: z.boolean().optional(),
});

/** Every ensure outcome except success; a busy writer is mapped by the shared error handler. */
type CoverageFailure = Exclude<EnsureCoverageResult, { kind: "covered" }>;

/** Registers schedule HTTP routes; validation and status mapping live only here. */
export function registerScheduleRoutes(
  server: FastifyInstance,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/schedule", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = scheduleWindowQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }

    const coverage = await schedules.ensureCoverage(id, request.log);
    // A disabled or unschedulable channel still serves what it already has.
    if (
      coverage.kind !== "covered" &&
      coverage.kind !== "disabled" &&
      coverage.kind !== "unschedulable"
    ) {
      return sendCoverageFailure(reply, id, coverage);
    }
    const window = await schedules.readWindow(
      id,
      query.data.start,
      query.data.end,
    );
    // Entries generated before the channel became unschedulable stay valid.
    if (coverage.kind === "unschedulable" && window.entries.length === 0) {
      return sendCoverageFailure(reply, id, coverage);
    }
    return toApiScheduleWindow(window);
  });

  server.post("/channels/:id/schedule/generate", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = generateBody.safeParse(request.body ?? {});
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }

    const { through, regenerate } = body.data;
    const coverage =
      regenerate === true
        ? await schedules.regenerate(id, request.log, through)
        : await schedules.ensureCoverage(id, request.log, through);
    if (coverage.kind !== "covered") {
      return sendCoverageFailure(reply, id, coverage);
    }
    return {
      scheduleRevision: coverage.scheduleRevision,
      generatedThrough: toApiTimestamp(coverage.generatedThrough),
    };
  });
}

// Maps each coverage failure to its status. A gap is a 409 until gap repair replaces it.
function sendCoverageFailure(
  reply: FastifyReply,
  channelId: string,
  failure: CoverageFailure,
) {
  switch (failure.kind) {
    case "channel_not_found":
      return sendChannelNotFound(reply, channelId);
    case "disabled":
      return sendChannelDisabled(reply, channelId);
    case "unschedulable":
      return sendApiError(
        reply,
        409,
        "channel_unschedulable",
        `Channel ${channelId} cannot generate a schedule`,
        { reason: failure.reason },
      );
    case "through_out_of_range":
      return sendThroughOutOfRange(reply, "through", failure.latestThrough);
  }
}

// Shapes one schedule window for the API; each entry converts its own instants.
function toApiScheduleWindow(window: ScheduleWindow) {
  return {
    scheduleRevision: window.scheduleRevision,
    entries: window.entries.map(toApiScheduleEntry),
  };
}

// Converts one entry's instants; durations stay in milliseconds.
function toApiScheduleEntry(entry: ScheduleEntry) {
  return {
    ...entry,
    startsAt: toApiTimestamp(entry.startsAt),
    endsAt: toApiTimestamp(entry.endsAt),
    createdAt: toApiTimestamp(entry.createdAt),
    updatedAt: toApiTimestamp(entry.updatedAt),
  };
}
