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
    // The disposition tells real video from an audio file's cover art.
    "format=duration:stream=codec_type:stream_disposition=attached_pic",
    "-i",
    path,
  ];
}
