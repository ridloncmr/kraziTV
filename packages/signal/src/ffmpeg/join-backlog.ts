/**
 * How much recent signal a newly tuned viewer receives at once, so Plex's
 * player buffer fills on arrival instead of at wall-clock speed. Viewers
 * therefore watch about this far behind the schedule (ADR 0018). The join
 * point counts it in keyframes, one per second at the packager's fixed GOP;
 * a session's first FFmpeg process bursts it so the first viewer gets it too.
 */
export const JOIN_BACKLOG_MS = 10_000;
