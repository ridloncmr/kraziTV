/** A folder or file name with release tokens removed and its year split out. */
export interface ParsedName {
  /** Undefined when nothing but release tokens or punctuation remained. */
  name?: string;
  year?: number;
  /**
   * A country tag written after the name, as `(US)` or `(UK)`, in TMDB's
   * ISO 3166-1 form: `US`, `GB`. It tells apart same-named series by origin.
   */
  country?: string;
}

// Resolutions, `4K`, `UHD`, `HDR`, sources, codecs, and audio formats from the
// spec. Whole words only, so `Charlotte's Web` keeps its title.
const TOKENS =
  "480p|576p|720p|1080p|2160p|4k|uhd|hdr|hdr10|dv|bluray|bdrip|brrip|web-dl|webrip|hdrip|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|ac3|eac3|ddp|dts|truehd|atmos|aac|10bit|8bit|proper|repack|amzn|dsnp";

// A whole-word release token, with the scene release group a token may carry,
// as in `x264-SPARKS`.
const RELEASE_TOKEN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${TOKENS})(?:-[\\p{L}\\p{N}]+)?(?![\\p{L}\\p{N}])`,
  "giu",
);

// Edition labels a filename adds after the title, as `Saw - Uncut Edition`
// or `Jumanji Special Edition`. A modifier counts only with its noun, so
// `Final Destination` and `Uncut Gems` keep their titles; the three
// standalone words name no film on their own.
const EDITION = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:(?:special|extended|uncut|unrated|theatrical|ultimate|collector'?s|director'?s|final|anniversary|limited|remastered|imax|definitive|international)\\s+(?:edition|cut|version)|unrated|remastered|theatrical)(?![\\p{L}\\p{N}])",
  "giu",
);

// A bare year counts only right before a release token, as in
// `Gladiator.2000.1080p`, so titles such as `Blade Runner 2049` keep their
// numbers. Text must precede it, so `1917.2019.2160p` stays titled `1917`.
const SCENE_YEAR = new RegExp(
  `(?<=\\S\\s+)((?:19|20)\\d{2})(?=\\s+(?:${TOKENS})(?![\\p{L}\\p{N}]))`,
  "iu",
);

// `(2002)`, or a run of years as season folders write them: `(1999-2000)`.
const PARENTHESIZED_YEAR = /\(((?:19|20)\d{2})(?:\s*[-–]\s*\d{2,4})?\)/;

// Country tags Plex and Sonarr write after a series name, by TMDB's code.
const COUNTRIES: Record<string, string> = {
  us: "US",
  uk: "GB",
  gb: "GB",
  au: "AU",
  ca: "CA",
  nz: "NZ",
  ie: "IE",
  jp: "JP",
  kr: "KR",
  cn: "CN",
  fr: "FR",
  de: "DE",
  it: "IT",
  es: "ES",
  br: "BR",
  mx: "MX",
  in: "IN",
  nl: "NL",
  se: "SE",
  dk: "DK",
  no: "NO",
  fi: "FI",
  pl: "PL",
  ru: "RU",
};
const COUNTRY_TAG = new RegExp(
  `\\((${Object.keys(COUNTRIES).join("|")})\\)`,
  "iu",
);

const BRACKETED = /\[[^\]]*\]|\{[^}]*\}/g;

// Parentheses left with nothing inside once their release tokens are gone.
const EMPTY_PARENTHESES = /\(\s*\)/g;

// A copy number a download or rip appends, as in `Movie (2007)(1)`.
const COPY_NUMBER = /\s*\(\d{1,2}\)$/;

// Punctuation left at either end once tokens are gone, as in `Show - `.
const EDGE_PUNCTUATION = /^[\s\-–—_.,:;]+|[\s\-–—_.,:;]+$/g;

/**
 * Cleans a name for use as a title or series hint. A year counts in
 * parentheses, or bare right before a release token; a country tag such as
 * `(US)` is split out; scene-style names without spaces split on dots and
 * underscores.
 */
export function parseName(raw: string): ParsedName {
  let text = raw.replace(BRACKETED, " ");
  if (!text.includes(" ")) text = text.replace(/[._]/g, " ");
  // Before the year, so `Alien.1979.Remastered.2160p` still dates itself.
  text = text.replace(EDITION, " ");

  const yearMatch = PARENTHESIZED_YEAR.exec(text) ?? SCENE_YEAR.exec(text);
  if (yearMatch) {
    text =
      text.slice(0, yearMatch.index) +
      " " +
      text.slice(yearMatch.index + yearMatch[0].length);
  }
  const countryMatch = COUNTRY_TAG.exec(text);
  if (countryMatch) text = text.replace(COUNTRY_TAG, " ");

  const name = text
    .replace(RELEASE_TOKEN, " ")
    .replace(EMPTY_PARENTHESES, " ")
    .replace(/\s+/g, " ")
    .replace(EDGE_PUNCTUATION, "")
    .replace(COPY_NUMBER, "")
    .replace(EDGE_PUNCTUATION, "");
  const parsed: ParsedName = {};
  if (name.length > 0) parsed.name = name;
  if (yearMatch) parsed.year = Number(yearMatch[1]);
  if (countryMatch) {
    parsed.country = COUNTRIES[countryMatch[1]?.toLowerCase() ?? ""];
  }
  return parsed;
}
