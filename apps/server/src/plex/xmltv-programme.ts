import type { GuideProgramme } from "@krazitv/plex";

import { resumeMessage } from "../playout/resume-message.js";
import type { GuideProgram, ScheduleEntry } from "../schedules/contracts.js";

/**
 * Shapes one guide program for XMLTV: the release as its compact date, the
 * kind as a leading Series or Movie category ahead of the genres, and the
 * poster as the icon. The wording itself is the guide's, shared with the
 * Program Guide, so Plex and the web agree on every title.
 */
export function xmltvProgramme(
  entry: Pick<ScheduleEntry, "startsAt" | "endsAt">,
  program: GuideProgram,
): GuideProgramme {
  return {
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    title: program.title,
    subTitle: program.subTitle,
    description: program.description,
    date: program.releaseDate?.replaceAll("-", "") ?? null,
    categories: [
      ...(program.kind === "episode"
        ? ["Series"]
        : program.kind === "movie"
          ? ["Movie"]
          : []),
      ...program.genres,
    ],
    iconUrl: program.posterUrl,
    episode: program.episode,
  };
}

/**
 * Shapes one planned filler interval for XMLTV as **Off air**, so a Plex
 * guide shows why nothing is listed and when programming resumes, worded as
 * the on-screen message is (ADR 0022). It carries no category, artwork, or
 * episode, since nothing airs.
 */
export function offAirProgramme(
  interval: { startsAt: number; endsAt: number },
  timeZone: string,
): GuideProgramme {
  return {
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
    title: "Off air",
    description: `${resumeMessage(interval.endsAt, timeZone)}.`,
  };
}
