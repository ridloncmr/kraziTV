import { defaultFillerFontFile } from "@krazitv/signal";

/**
 * Resolves the FFmpeg executable once at startup, mirroring `FFPROBE_PATH`,
 * so operators can point at a build outside PATH.
 */
export function parseFfmpegPath(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/**
 * Resolves the font filler messages are drawn in: `FFMPEG_FONT_FILE`, else
 * the platform default SignalPackager names (Arial on Windows, fontconfig's
 * choice elsewhere), so filler works out of the box on every host.
 */
export function parseFfmpegFontFile(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string | undefined {
  return (
    env.FFMPEG_FONT_FILE?.trim() || defaultFillerFontFile(platform, env.WINDIR)
  );
}
