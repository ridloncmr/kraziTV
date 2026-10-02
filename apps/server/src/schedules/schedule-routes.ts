import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { sendChannelNotFound } from "../channels/routes/channel-routes.js";
import { WriteAuthorityBusyError } from "../database/writes/immediate-transaction.js";
import { sendApiError, sendInvalidRequest } from "../http/api-error.js";
import { toApiTimestamp } from "../http/api-timestamp.js";
import { idParams, isoInstantField } from "../http/request-schemas.js";
import type {
  EnsureCoverageResult,
  ScheduleEntry,
  ScheduleWindow,
} from "./contracts.js";
import { SCHEDULE_REQUEST_LIMIT_MS } from "./schedule-coverage.js";
import type { ScheduleService } from "./schedule-service.js";

const windowQuery = z
  .strictObject({ start: isoInstantField, end: isoInstantField })
  .refine((window) => window.end > window.start, {
    message: "end must be after start",
    path: ["end"],
  })
  .refine((window) => window.end - window.start <= SCHEDULE_REQUEST_LIMIT_MS, {
    message: "the window must not exceed 7 days",
    path: ["end"],
  });

// `regenerate` rebuilds from the boundary instead of only extending.
const generateBody = z.strictObject({
  through: isoInstantField.optional(),
  regenerate: z.boolean().optional(),
});

/** Every ensure outcome except success, plus a writer that stayed busy. */
type CoverageFailure =
  Exclude<EnsureCoverageResult, { kind: "covered" }> | { kind: "busy" };

/** Registers schedule HTTP routes; validation and status mapping live only here. */
export function registerScheduleRoutes(
  server: FastifyInstance,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/schedule", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = windowQuery.safeParse(request.query);
    if (!query.success) {
      return sendInvalidRequest(reply, query.error);
    }

    const coverage = await reportBusy(() =>
      schedules.ensureCoverage(id, request.log),
    );
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
    const coverage = await reportBusy(() =>
      regenerate === true
        ? schedules.regenerate(id, request.log, through)
        : schedules.ensureCoverage(id, request.log, through),
    );
    if (coverage.kind !== "covered") {
      return sendCoverageFailure(reply, id, coverage);
    }
    return {
      scheduleRevision: coverage.scheduleRevision,
      generatedThrough: toApiTimestamp(coverage.generatedThrough),
    };
  });
}

// Reports a writer that stayed busy as an outcome, so routes answer it as retryable instead of a 500.
async function reportBusy(
  write: () => Promise<EnsureCoverageResult>,
): Promise<EnsureCoverageResult | { kind: "busy" }> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof WriteAuthorityBusyError) return { kind: "busy" };
    throw error;
  }
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
      return sendApiError(
        reply,
        409,
        "channel_disabled",
        `Channel ${channelId} is disabled`,
      );
    case "unschedulable":
      return sendApiError(
        reply,
        409,
        "channel_unschedulable",
        `Channel ${channelId} cannot generate a schedule`,
        { reason: failure.reason },
      );
    case "through_out_of_range":
      return sendApiError(
        reply,
        400,
        "invalid_request",
        `through must not be after ${toApiTimestamp(failure.latestThrough)}`,
      );
    case "busy":
      return sendApiError(
        reply,
        503,
        "schedule_busy",
        "The schedule is busy; retry the request",
        { retryable: true },
      );
  }
}

// Converts internal epoch milliseconds to the ISO 8601 strings the API promises.
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
