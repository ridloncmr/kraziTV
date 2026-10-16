/**
 * The font filler messages are drawn in when none is configured. FFmpeg's
 * Windows builds ship fontconfig without a default config, so `drawtext`
 * finds no font there and would fail the whole item; Windows always has
 * Arial. Elsewhere fontconfig resolves a default, so none is named.
 */
export function defaultFillerFontFile(
  platform: NodeJS.Platform,
  windowsDirectory = "C:\\Windows",
): string | undefined {
  return platform === "win32"
    ? `${windowsDirectory.replaceAll("\\", "/")}/Fonts/arial.ttf`
    : undefined;
}
