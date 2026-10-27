import type { GuideProgramme } from "@krazitv/plex";

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
