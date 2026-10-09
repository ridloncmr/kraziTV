/** A folder or file name with release tokens removed and its year split out. */
export interface ParsedName {
  /** Undefined when nothing but release tokens or punctuation remained. */
  name?: string;
  year?: number;
}

// Resolutions, `4K`, `UHD`, `HDR`, sources, and codecs from the spec.
const TOKENS =
  "480p|576p|720p|1080p|2160p|4k|uhd|hdr|bluray|bdrip|brrip|web-dl|hdtv|dvdrip|x264|x265|hevc|ac3|dts";

// A whole-word release token, with the scene release group a token may carry,
// as in `x264-SPARKS`.
const RELEASE_TOKEN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${TOKENS})(?:-[\\p{L}\\p{N}]+)?(?![\\p{L}\\p{N}])`,
  "giu",
);

// A bare year counts only right before a release token, as in
// `Gladiator.2000.1080p`, so titles such as `Blade Runner 2049` keep their
// numbers. Text must precede it, so `1917.2019.2160p` stays titled `1917`.
const SCENE_YEAR = new RegExp(
  `(?<=\\S\\s+)((?:19|20)\\d{2})(?=\\s+(?:${TOKENS})(?![\\p{L}\\p{N}]))`,
  "iu",
);

const PARENTHESIZED_YEAR = /\((\d{4})\)/;

const BRACKETED = /\[[^\]]*\]|\{[^}]*\}/g;

// Parentheses left with nothing inside once their release tokens are gone.
const EMPTY_PARENTHESES = /\(\s*\)/g;

// Punctuation left at either end once tokens are gone, as in `Show - `.
const EDGE_PUNCTUATION = /^[\s\-–—_.,:;]+|[\s\-–—_.,:;]+$/g;

/**
 * Cleans a name for use as a title or series hint. A year counts in
 * parentheses, or bare right before a release token; scene-style names
 * without spaces split on dots and underscores.
 */
export function parseName(raw: string): ParsedName {
  let text = raw.replace(BRACKETED, " ");
  if (!text.includes(" ")) text = text.replace(/[._]/g, " ");

  const yearMatch = PARENTHESIZED_YEAR.exec(text) ?? SCENE_YEAR.exec(text);
  if (yearMatch) {
    text =
      text.slice(0, yearMatch.index) +
      " " +
      text.slice(yearMatch.index + yearMatch[0].length);
  }

  const name = text
    .replace(RELEASE_TOKEN, " ")
    .replace(EMPTY_PARENTHESES, " ")
    .replace(/\s+/g, " ")
    .replace(EDGE_PUNCTUATION, "");
  const parsed: ParsedName = {};
  if (name.length > 0) parsed.name = name;
  if (yearMatch) parsed.year = Number(yearMatch[1]);
  return parsed;
}
