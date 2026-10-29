import type { ChannelState } from "../http/contracts/channels.js";

/**
 * Names what airs: a program by its title, planned filler as Off air with
 * the resume time the server worded in the programming timezone.
 */
export function airingLabel(
  item: NonNullable<ChannelState["currentItem"]>,
): string {
  return item.type === "filler"
    ? `Off air — programming resumes at ${item.resumeTime}`
    : item.title;
}

/**
 * Says in the owner's words why nothing is on air, from the server's reason
 * code; a code this browser does not know yet gets a plain fallback. A gap
 * has several causes, such as shows whose media is missing or too short to
 * air or only rule-only shows with no rule active, so its advice names every
 * place to look.
 */
export function offAirWords(reason: ChannelState["reason"]): string {
  switch (reason) {
    case "schedule_gap":
      return "Nothing is scheduled right now. Check that the channel's shows have media that can air (not missing or too short), and its Lineup and Rules tabs.";
    case "media_unavailable":
      return "The program scheduled now can't be played. Its file may be missing; check the Media Library.";
    default:
      return "Nothing is on air right now.";
  }
}
