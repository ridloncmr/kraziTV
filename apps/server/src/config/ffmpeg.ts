/**
 * Resolves the FFmpeg executable once at startup, mirroring `FFPROBE_PATH`,
 * so operators can point at a build outside PATH.
 */
export function parseFfmpegPath(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env.FFMPEG_PATH?.trim() || "ffmpeg";
}
