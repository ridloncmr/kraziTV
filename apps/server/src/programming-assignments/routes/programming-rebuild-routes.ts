import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { StopInterrupted } from "../../channels/runtime/settle-runtime-stop.js";
import {
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import { freshRebuildChange } from "../writes/fresh-rebuild.js";

// The browser makes one key per rebuild it confirms and repeats it on retry.
const rebuildBody = z.strictObject({
  idempotencyKey: z.string().min(1).max(200),
});

/**
 * Registers the fresh rebuild route. After the rebuild commits, the
 * channel's worker is stopped so viewers tune in to the new schedule; a
 * failed stop rolls nothing back and is reported for a cleanup retry,
 * which repeats the request with the same key.
 */
export function registerProgrammingRebuildRoutes(
  server: FastifyInstance,
  schedules: ScheduleService,
  stopInterrupted: StopInterrupted,
): void {
  server.post("/channels/:id/programming/rebuild", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = rebuildBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await schedules.applyInputChange(
      request.log,
      "programming_rebuilt",
      freshRebuildChange(id, body.data.idempotencyKey),
    );
    if (result.kind === "channel_not_found") {
      return sendChannelNotFound(reply, id);
    }
    const stopped = await stopInterrupted(id, request.log);
    return { rebuilt: result.kind === "rebuilt", stopFailed: !stopped };
  });
}
