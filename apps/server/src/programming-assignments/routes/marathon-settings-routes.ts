import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ChannelRepository } from "../../channels/repository/channel-repository.js";
import {
  sendChannelNotFound,
  sendInvalidRequest,
} from "../../http/api-error.js";
import { idParams } from "../../http/request-schemas.js";
import type { ScheduleService } from "../../schedules/schedule-service.js";
import type { AssignmentRepository } from "../persistence/assignment-repository.js";
import { assignmentChange } from "../writes/assignment-change.js";

// The chance is a whole percentage; the cooldown a whole number of rounds.
const settingsBody = z.strictObject({
  marathonChancePercent: z.number().int().min(0).max(100),
  marathonMinOrdinaryRounds: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER),
});

/**
 * Registers a channel's programming settings routes: the marathon chance
 * and cooldown every rotation on the channel shares. Validation and status
 * mapping live only here.
 */
export function registerMarathonSettingsRoutes(
  server: FastifyInstance,
  assignments: AssignmentRepository,
  channels: ChannelRepository,
  schedules: ScheduleService,
): void {
  server.get("/channels/:id/programming-settings", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if ((await channels.findById(id)) === undefined) {
      return sendChannelNotFound(reply, id);
    }
    return toApiSettings(await assignments.readMarathonSettings(id));
  });

  // A change applies from the next round formed after the airing program;
  // the started turn and any started marathon stand.
  server.put("/channels/:id/programming-settings", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = settingsBody.safeParse(request.body);
    if (!body.success) {
      return sendInvalidRequest(reply, body.error);
    }
    const result = await schedules.applyInputChange(
      request.log,
      "marathon_settings_changed",
      assignmentChange(id, "saved", (trx, now) =>
        assignments.saveMarathonSettings(
          trx,
          id,
          {
            chancePercent: body.data.marathonChancePercent,
            minOrdinaryRounds: body.data.marathonMinOrdinaryRounds,
          },
          now,
        ),
      ),
    );
    return result.kind === "channel_not_found"
      ? sendChannelNotFound(reply, id)
      : toApiSettings(result.settings);
  });
}

// Names the settings as the API does.
function toApiSettings(settings: {
  chancePercent: number;
  minOrdinaryRounds: number;
}) {
  return {
    marathonChancePercent: settings.chancePercent,
    marathonMinOrdinaryRounds: settings.minOrdinaryRounds,
  };
}
