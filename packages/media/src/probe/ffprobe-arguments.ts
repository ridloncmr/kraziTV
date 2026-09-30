/**
 * Builds the structured ffprobe argv for one file. Requesting only the fields
 * the parser reads keeps output small and well under the stdout limit.
 */
export function buildFfprobeArguments(path: string): string[] {
  return [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-i",
    path,
  ];
}
