# Content Metadata Enrichment

Status: In Development

## Problem

The catalog discovers local files and probes technical facts, but filename-derived
titles cannot reliably identify series, episode order, franchises, or themes.
Useful programming should not require users to classify thousands of files.

## Goals

- Enrich catalog media with normalized content metadata after technical probing.
- Identify media whose filename lacks the title by reading its folder hierarchy.
- Support uncertain matches and durable user corrections.
- Keep local scanning and broadcasting useful without a metadata service.
- Provide facts that collections and playback ordering can consume independently.

## Non-goals

- Collection creation, channel rules, or schedule generation.
- Implementing Plex, Jellyfin, and external metadata integrations simultaneously.
- Dynamic provider registration, a plugin framework, or a universal matching engine.
- Cross-root file deduplication, media acquisition, or comprehensive artwork hosting.
- A project-supplied TMDB key, and providers other than TMDB (TVDB, `.nfo`
  sidecars, or Plex or Jellyfin as metadata sources). They remain later options.
- Using content metadata in guide output such as XMLTV episode titles or
  descriptions. This spec stores the facts; guide use is a separate decision.

## Dependencies And Spec Boundary

Depends on the existing catalog scan and normalized probe results. This capability
has its own matching, correction, and failure lifecycle; downstream programming
consumes accepted facts rather than performing lookups. The first provider is
TMDB (see [Provider](#provider)). TMDB's terms (last updated 2023-10-20) and
authentication docs were rechecked on 2026-10-08; recheck them before each
later provider ticket, because they can change without notice.

## Established Behavior And Proposed Policy

The scanner already composes discovery, probing, candidate validation, and atomic
persistence, with an explicit enrichment seam after probing. Media item identity
is its media root and normalized path; enrichment must not replace that identity.

The sections below propose enrichment policy. They do not claim these fields or
provider operations already exist, or supersede accepted architectural decisions.

## User-Facing Behavior

1. The user turns enrichment on by entering their own TMDB API key through a
   **Set up TMDB** task link in Account Settings, beside the name, picture, and
   password links. Without a key, enrichment stays off.
2. A user scans local media with enrichment disabled or a configured provider enabled.
3. Scan progress shows content enrichment as its own `enriching` phase after
   probing, and the completed summary counts matches and items needing a choice
   (see [Scan Progress, Retry, And Refresh](#scan-progress-retry-and-refresh)).
4. Media Library shows accepted metadata and unresolved or ambiguous matches.
5. The user can choose a candidate, search TMDB in their own words when none
   fits, reject a match, correct a field (title, series, season, episode, or
   year), or clear a correction to allow provider updates again.
6. The user can retry enrichment for existing catalog items without reprobe.
7. For a folder of ambiguous disc-track files, the user can map every track to an
   episode in one **Map tracks to episodes** dialog instead of correcting each file.
8. Without a key, the desktop reminds the owner that only generic probing
   happens: a TMDB icon in the system tray and, at most once per reminder
   period, a tray balloon offering **Set up TMDB** (see
   [TMDB Setup Reminder](#tmdb-setup-reminder)).

A provider outage reports enrichment failures without turning technically usable
media into `probe_failed`. Unmatched media remains eligible for ordinary
collections and scheduling. It shows a fallback title built from its path hints,
such as `Firefly – S01E05` for `Firefly/Season 1/s01e05.mp4`, instead of the bare
filename; with no usable hints it keeps the filename-derived title.

## Technical Behavior

### Provider

TMDB is the first and only provider in this spec. It covers movies and TV with
series, season, and episode structure, title-and-year search, artwork, and stable
IDs, and is free for non-commercial use.

- **The user's own key.** Each install uses a TMDB API key its user requests from
  their own TMDB account. kraziTV never ships a key, so no install runs under
  another person's identity and one revoked key affects only its owner.
- **Configured in Account Settings.** The **Set up TMDB** dialog has a key box,
  **Save**, **Remove**, and **Cancel**. The account-settings program hosts the
  dialog, but the key's route belongs to the metadata domain, not `auth/`.
- **Stored as a secret.** The server stores the key and never returns it. Reads
  report only whether a key is set; the dialog offers replace and remove.
- **API Read Access Token, sent as a Bearer header.** TMDB accepts either an
  `api_key` query parameter or the account's API Read Access Token in an
  `Authorization: Bearer` header, with identical access. Its docs make the token
  the default; kraziTV asks for the token, and the header keeps the secret out of
  request URLs and logs.
- **Validated on save.** Saving makes one test call, `GET /3/authentication`. A
  `401` means TMDB rejected the key: it is not stored and the dialog shows the
  error. An unreachable TMDB also stores nothing.
  A later save or removal supersedes an earlier validation still in flight; the
  earlier request returns a conflict and cannot restore or overwrite the key.
- **No key, no lookups.** Without a key the scan derives path hints and skips the
  lookup step entirely; nothing is reported as an enrichment error.
- **Attribution.** The Set up TMDB dialog, and Media Library wherever it shows
  TMDB facts, display an official TMDB logo and the notice the terms require:
  `This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.`
  The logo is used unmodified, from TMDB's logos page, and stays less prominent
  than kraziTV's branding.
- **No AI use.** TMDB's terms forbid using its API with, or to train, an AI or
  machine-learning application. Matching stays rule-based, and TMDB data is
  never passed to a model.
- **Rate limits.** TMDB's soft ceiling is about 40 requests per second and may
  change. Every TMDB request goes through one shared in-memory queue that caps
  requests in flight and requests per second below that ceiling. Scans of every
  root, metadata-only retries, and background refresh all use it, so running
  more jobs never raises the request rate. A cancelled request leaves the queue
  without calling TMDB. HTTP `429` still backs off, as a fallback.
- **Six-month cache limit.** TMDB's terms forbid caching its data longer than six
  months. A background refresh keeps stored TMDB data inside that limit without
  user action or a catalog scan:
  - It checks at boot, as soon as any scan or retry job ends, and an hour
    after each check, refreshing items whose provider facts were fetched more
    than five months ago, oldest first. The month between five and six leaves
    room to retry while TMDB is unreachable. It never runs file discovery,
    ffprobe, or a new search.
  - It refreshes only items under enabled roots, so a disabled root makes no
    TMDB calls. Expiry covers every cataloged item, disabled roots included,
    and a re-enabled root's items refresh at the next check.
  - It re-fetches by stored TMDB ID: one call per movie, one per TV series for
    its name and poster, and one per TV season, so a large library costs a few
    hundred calls spread across months.
  - It replaces only provider facts. User corrections, rejections, and chosen
    matches are never touched; they are not TMDB data and never expire.
  - It never blocks or slows broadcasting, and commits through the same
    metadata-only path as a retry, revalidating item existence and corrections.
    Just before committing it checks again for a scan or retry job on the root;
    if one started meanwhile, it discards its results and tries again when
    that job ends.
  - A failed refresh keeps the match, shows its error in the item's details,
    and retries at the next check. A TMDB ID that TMDB no longer knows is a failed
    refresh like any other, and its data expires on schedule.
  - With no key set, refresh does not run, and stored data expires at six
    months.
- **Expiry.** Provider facts that cannot be refreshed before six months are
  dropped: title, description, genres, release date, franchise name, poster,
  and series name. The match, its TMDB IDs, the content type, and the season
  and episode numbers are kept, so episode order survives. The item shows its
  path-hint fallback title until a later refresh refills it.
- **Candidates.** An ambiguous item's candidate list is TMDB data too.
  Choosing or rejecting a candidate deletes the list. A list looked up more
  than six months ago is deleted and the item returns to unmatched, so the
  next scan looks it up again.

### TMDB Setup Reminder

Without a key the catalog still scans, but titles come only from path hints.
The desktop shell says so where the owner will see it, without blocking any
program:

- **Tray icon.** While no key is set, the system tray shows a TMDB icon labeled
  `TMDB isn't set up`. It stays even after the owner turns the reminder off,
  so the setting is never lost. Clicking it opens the balloon.
- **Tray balloon.** At desktop start, the balloon opens by itself when no key
  is set, at least one media root exists, and the reminder is due. With no
  media root there is nothing to enrich, so it stays closed. It reads:
  `TMDB isn't set up` / `kraziTV can only read titles from file names. Set up
TMDB to look up series, episodes, and movies.` Its actions:

  | Action              | Effect                                                                    |
  | ------------------- | ------------------------------------------------------------------------- |
  | **Set up TMDB**     | Opens Account Settings on the Set up TMDB task; snoozes like Remind later |
  | **Remind me later** | Closes the balloon; it opens by itself again after 7 days                 |
  | **Don't remind me** | Closes the balloon; it never opens by itself again in this browser        |
  | Close (**✕**)       | Same as **Remind me later**                                               |

- **Reminder state is desktop shell state.** The browser keeps it in
  `localStorage`, so each browser reminds on its own. Unreadable or missing
  state counts as due. It never reaches the server or changes enrichment.
- **A saved key ends the reminder at once.** Saving a key removes the icon and
  closes the balloon; removing the key brings the icon back, and the balloon
  follows the stored reminder state.
- **Scan summary.** A completed scan without a key adds the line
  `TMDB isn't set up, so titles come from file names.` to its summary.

### Normalized Facts

Represent content type as movie, episode, or unknown. Unknown facts remain absent;
filename guesses are not accepted facts. Preserve date precision: a known year
does not imply January 1 of that year.

The first release stores the facts downstream specs consume, plus the cheap
display facts that arrive in the same TMDB response:

| Fact                      | Consumer                                         | Source                                                     |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Content type              | Every consumer                                   | TMDB or user correction                                    |
| Title (movie or episode)  | Media Library, display                           | TMDB or user correction                                    |
| Series identity and name  | Spec 0002 series collections, spec 0003 ordering | TMDB or user correction                                    |
| Season and episode number | Spec 0003 episode order                          | TMDB or user correction                                    |
| Release date or year      | Spec 0003 release order, remake distinction      | TMDB or user correction                                    |
| Franchise                 | Spec 0002 franchise collections                  | TMDB collection for movies; user correction for all others |
| Genres                    | Spec 0002 genre collections                      | TMDB or user correction                                    |
| Tags and themes           | Spec 0002 theme collections                      | User only; TMDB keywords are not imported                  |
| Description               | Media Library                                    | TMDB or user correction                                    |
| Poster reference          | Media Library, candidate choice                  | TMDB image path for a movie or series                      |

Artwork is one poster reference per movie or series. kraziTV stores only TMDB's
image path; the browser loads the image from TMDB, and kraziTV never downloads or
hosts image files. Episode stills, backdrops, and logos are out of scope.

Series and franchise identity must distinguish remakes and similarly named works.
Provider IDs are references attached to normalized identities, not scheduling IDs.
Multi-episode files must retain the information needed to explain their identity;
their initial ordering treatment is decided in spec 0003.

### Path Hints

Filenames often omit the title: `Firefly/Season 1/s01e05.mp4`, `Some Show/t_01.mkv`,
or `Alien (1979)/movie.mkv`. A persistence-free path-hint step reads the filename
and its parent folders up to the media root and returns path hints: series or
title, year, season, episode or episode range, disc and disc-track numbers, and
whether the file is an extra. It performs
no I/O beyond the already-discovered path and runs without a provider.

| Path                                                        | Path hints                                             | Hint strength |
| ----------------------------------------------------------- | ------------------------------------------------------ | ------------- |
| `Firefly/Season 1/s01e05.mp4`                               | series `Firefly` (grandparent), season 1, ep. 5        | Strong        |
| `Firefly (2002)/s01e05.mp4`                                 | series `Firefly`, year 2002, season 1, ep. 5           | Strong        |
| `Show/s01e05-e06.mkv`                                       | series `Show`, season 1, episodes 5–6                  | Strong        |
| `Survivor/Survivor - Season 44/Survivor - S44E10.mkv`       | series `Survivor`, season 44, ep. 10                   | Strong        |
| `Shameless (US) (2011)/Season 9/s09e08.mkv`                 | series `Shameless`, country `US`, year 2011, S9 E8     | Strong        |
| `Columbo/Columbo - (S07EP03) - (1978) Title.mp4`            | series `Columbo`, season 7, ep. 3                      | Strong        |
| `Wolverine/Wolverine - Episode 04 - Omega Red.mp4`          | series `Wolverine`, ep. 4, no season (absolute number) | Strong        |
| `Bleach/Season 04 The Bount/Bleach 64.mkv`                  | series `Bleach`, season 4, ep. 64                      | Strong        |
| `Alien (1979)/movie.mkv`                                    | title `Alien`, year 1979                               | Strong        |
| `Saw - Uncut Edition (2005)/Saw - Uncut Edition (2005).mkv` | title `Saw`, year 2005                                 | Strong        |
| `Some Show/t_01.mkv`                                        | series `Some Show`, disc track 1                       | Weak          |
| `TV/Downloads/s01e05.mp4`                                   | season 1, ep. 5; no series                             | Weak          |

**Series folder.** A show's own folder holds its season folders, however
those are named, so the outermost folder below the media root that names
something is the series folder for every episode beneath it: it names the
series and gives its year and country tag. Folders between it and the file
only contribute a season or disc number: `Survivor - Season 44`, `Book One -
Water`, `Attack On Titan (Season 4 Part 2)`, and `Season 1 (1999-2000)` never
become series. A filename that names the series itself, as `Survivor -
S44E10`, or a longer name containing the folder's, as `Survivorman and Son`
under `Survivorman/`, agrees with its folder, and the folder's name, year,
and country win; a filename naming something else, as `Firefly.S01E05` under
`Random Stuff/`, is a loose file in a mixed folder and keeps its own name and
year. A movie still takes its title from its filename, or from the nearest
naming folder when the filename is generic.

- Skip structural and generic folder names when looking for a series or title,
  using the built-in list below. Never treat a skipped folder, or the media root
  itself, as a series or title.
- Strip release tokens from folder and file names before extracting a title:
  bracketed text, resolutions (`480p`, `720p`, `1080p`, `2160p`), `4K`, `UHD`,
  `HDR`, sources (`BluRay`, `BDRip`, `BRRip`, `WEB-DL`, `WEBRip`, `HDTV`,
  `DVDRip`, `Remux`), codecs and audio formats (`x264`, `x265`, `HEVC`, `AC3`,
  `EAC3`, `DTS`, `TrueHD`, `Atmos`, `AAC`, `10bit`), and release notes
  (`PROPER`, `REPACK`, `AMZN`, `DSNP`). `Firefly (2002) [1080p BluRay x265]`
  yields series `Firefly`, year 2002.
- Strip edition labels (`Special Edition`, `Director's Cut`, `Extended
Version`, `Unrated`, `Remastered`, `Theatrical`) and a copy number such as
  `(1)`, so `Saw - Uncut Edition (2005)` is titled `Saw`. A modifier counts
  only with its noun, so `Uncut Gems` and `Final Destination` keep their
  titles.
- Read a country tag such as `(US)` or `(UK)` as a country hint, never as part
  of the name, so `Shameless (US)` searches for `Shameless` and prefers the
  series TMDB lists from the United States.
- Read an episode code in any of these forms: `S01E05`, `S01 E05`, `S07EP03`,
  `7x03`, a range `S01E05-E06` or `S01E05E06`, a segment letter as in
  `S03E04a` or `S01E01AB` (ignored), `SS016` for a special in season 0, and
  `Episode 04` or `Ep. 04` with no season, which counts through the whole
  series, or takes the season folder's season when there is one. Under a
  season folder a bare trailing number, as `Bleach 64`, is the episode too.
- Take a title from the filename only when it carries more than episode
  numbering or disc-track tokens; otherwise use the nearest non-skipped folder.
- A scene-style filename of the folder's title and year, as `Annabelle.2014`
  under `Annabelle (2014)/`, names the same thing as the folder.
- Keep a disc-track number distinct from an episode number. Rip track order
  often differs from broadcast order, so a track number never becomes an episode.
- A year in the folder or filename, such as `(2002)`, is a hint that helps
  distinguish remakes; it is not an accepted release date.
- Keep both numbers of an episode range so spec 0003 can order multi-episode files.

**Built-in folder list.** The list is fixed in code, not user-configurable: a
missed generic name yields an unmatched or ambiguous item the user resolves once
per folder, and new names join the list in code. Names match the whole folder
name, ignoring case, so `My Movies` is not skipped.

| Group          | Folder names                                                                                                                                                                                                                                                                                                                                                                       | Effect                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Season         | `Season`, `Series`, `Staffel`, `Saison`, `Temporada`, `Stagione`, `Seizoen`, `Säsong`, `Sæson`, `Sezon`, `Kausi`, `Сезон`, `シーズン`, or `시즌` with a number; `S1`, `S01`; anywhere in a folder that names nothing else, as `Season 04 The Bount` or `(Season 4 Part 2)`, and after a series name, as `Firefly Season 1`; a year range such as `Season 1 (1999-2000)` is ignored | Skipped; season number hint         |
| Season zero    | `Specials`                                                                                                                                                                                                                                                                                                                                                                         | Skipped; season 0 hint              |
| Extras         | `Trailers`, `Behind the Scenes`, `Deleted Scenes`, `Featurettes`, `Interviews`, `Scenes`, `Shorts`, `Clips`, `Sample`, `Samples`, `Extra`, `Extras`, `Other`                                                                                                                                                                                                                       | Skipped; marks the file as an extra |
| Disc structure | `VIDEO_TS`, `AUDIO_TS`, `BDMV`, `STREAM`, `PLAYLIST`, `CERTIFICATE`                                                                                                                                                                                                                                                                                                                | Skipped                             |
| Disc numbering | `Disc`, `Disk`, `DVD`, or `CD` with a number                                                                                                                                                                                                                                                                                                                                       | Skipped; disc number hint           |
| Quality split  | `4K`, `UHD`, `HD`, `SD`, `720p`, `1080p`, `2160p`, `Remux`, `Plex Versions`                                                                                                                                                                                                                                                                                                        | Skipped                             |
| Catch-all      | `TV`, `TV Shows`, `Shows`, `Series`, `Movies`, `Films`, `Video`, `Videos`, `Media`, `Library`, `Downloads`, `Anime`, `Cartoons`, `Kids`, `Documentaries`, `Recorded TV`, `Recordings`, `DVR`, `Unsorted`, `Incoming`, `Completed`, `New Folder`, `Plex`, `Jellyfin`                                                                                                                | Skipped                             |

A file under an extras folder, such as `Firefly/Featurettes/making-of.mkv`, is
bonus material, not an episode or movie: it is never automatically matched and
its content type stays unknown, but it stays in the catalog. A bare number is not
a season folder, because titles such as `24` and `1923` collide with it.

Path hints are evidence, not content metadata. They build the provider query and
are recorded with the match evidence; they become accepted facts only when a
provider match or a user correction confirms them. The fallback display title
uses them without accepting them.

### Matching And Corrections

Use explainable match states: unmatched, ambiguous, matched, and rejected, with a
separate enrichment error when lookup fails. Record provider, external identity,
lookup time, and matching evidence. Keep provider-specific confidence separately
when supplied; do not compare unrelated providers' scores as a universal ranking.

Weak path hints never yield an automatic match. A candidate found from weak
hints, such as a folder name plus a disc-track number, is recorded as ambiguous
for the user to resolve, even when the provider returns a single candidate.

Accept a match automatically only when exactly one sensible answer exists; a
silently wrong match costs more than one user choice. Compare titles after
normalization: ignore case, punctuation, diacritics, and a leading "The",
treat `&` and `and` as equal, and read a hyphen, dash, slash, or colon as a
word break, so `Obi-Wan Kenobi` and `Obi Wan Kenobi` agree
([ADR 0017](../../../../adrs/0017-series-folder-and-folder-evidence.md)).

| Case                                                    | Automatically matched when                                                                                                                                                                                                                                                                                                                                                                    | Otherwise                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Episode with strong hints (series, SxxEyy)              | Among the results with a matching title and a year agreeing with any year hint, exactly one lists every season the series folder holds, or, when several do, exactly one counts every episode the folder holds; or exactly one result agrees at all, whether or not it lists the episodes; a lone result of the hinted year with another title counts only when it lists the folder's seasons | Ambiguous; `Doctor Who/Season 1/s01e01.mkv` matches 1963 and 2005, which both list it |
| Episode, year-hinted, nothing agreeing holds the folder | The search is run again without the year, and exactly one same-titled result lists the folder's seasons; `Battlestar Galactica (2003)` finds the 2004 series rather than the 2003 miniseries                                                                                                                                                                                                  | As above                                                                              |
| Movie (title, optional year)                            | Exactly one result has a matching title and its year matches any year hint; or a year-hinted search found exactly one result of that year, as `Alien vs. Predator (2004)` finds `AVP: Alien vs. Predator`                                                                                                                                                                                     | Ambiguous; `The Thing/movie.mkv` matches 1951, 1982, and 2011                         |
| Weak path hints                                         | Never                                                                                                                                                                                                                                                                                                                                                                                         | Ambiguous                                                                             |
| No provider results                                     | —                                                                                                                                                                                                                                                                                                                                                                                             | Unmatched                                                                             |

A country hint such as `(US)` keeps only the same-titled results TMDB lists
from that country, when any is. Popularity never breaks a tie. Runtime is not
acceptance evidence, because TMDB episode runtimes are often missing and
extended cuts differ; the candidate choice can show each candidate's runtime
beside the probed duration to help the user decide.

**Episodes the series does not list.** Once a series is settled, by rule or
by the owner's choice, every episode file under its folder is matched to it.
A file whose season and episode TMDB lists takes that episode's facts. A file
TMDB does not list, as when TMDB counts a two-part episode once and TVDB
twice, is still matched to the series with the file's own season and episode
numbers and no episode title; Media Library shows it as `Matched; episode not
listed on TMDB`, and episode order (spec 0003) uses its numbers like any
other. A series folder never waits on a choice for numbering alone.

**Absolute numbering.** A season folder whose files are all numbered past
the season's TMDB episode count, with every number counting to that season
through the series from season 1, is numbered through the whole series, as
anime libraries number episodes: `Bleach/Season 3/s03e50.mkv` is season 3's
ninth episode when seasons 1 and 2 hold 41. One file numbered just past a
season's end is a numbering disagreement, not absolute numbering, and stays
as the file names it. An episode with no season, as `Episode 17`, counts
through the series the same way; past the last episode it keeps its number
with no season.

**Shared series per folder.** The series folder is the outermost naming
folder above an episode (see [Path Hints](#path-hints)), such as `Firefly/`
for `Firefly/Season 2/s02e01.mkv`, so it spans every season folder beneath
it, whatever they are called. Once one episode under a series folder has an
accepted series, automatically or by user choice, the other episode files
under that series folder use that series instead of searching again. Choosing
a series for one ambiguous episode resolves its siblings, keeps one show from
splitting across series, and saves lookups. A rejection or correction on one
file applies only to that file.

Effective metadata uses user corrections ahead of provider facts. The
correctable facts are title, series, season, episode, and release year; a
corrected year is stored as `YYYY` and read by release order like any date of
that precision. A correction on an item that needs a choice settles it: its
candidates are dropped and it is unmatched with the correction as its answer,
so it leaves Review matches and scans leave it alone until every correction
is cleared. A rejected association stays rejected on repeat scans unless the
user explicitly retries that association or clears the rejection. A transient failure preserves earlier
accepted facts. Rescanning must not overwrite corrected titles with filenames.

**Changed file at the same path.** Path hints come from the path, so re-matching
a replaced file at an unchanged path would find the same answer; a change never
resets a match automatically. Record the probed duration when a match is
accepted. When a later scan probes a duration more than 2 seconds away from it,
keep the match and corrections unchanged and flag the item in Media Library as
`File changed since it was matched`. The flag is derived on read from the two
durations, never stored. It offers **Keep match**, which records the new
duration as the match-time duration and so clears the flag, and **Correct
details…**, which opens the correction dialog; saving a correction there also
records the new duration. A matched item keeps no candidates, so the owner fixes
a wrong episode by correcting it rather than choosing among candidates. Size and
modification time are not signals: copies and backups change
them, and a re-encode of the same episode needs no review. Playability still
follows the new probe result. A renamed or moved file is a new path and so a new
media item, matched from scratch; carrying corrections across paths is out of
scope.

### Resolving Matches In Media Library

The owner resolves items that need a choice in one of two ways: one at a time
after filtering, or all at once in a walk-through.

| Way                | How it starts                                                                     | Suits                                |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------ |
| Filter             | **Filter…** → Match: **Needs your choice** on the Media Library list              | Fixing one item and moving on        |
| **Review matches** | A `Review matches (<n>)` button, or the scan summary's **Review matches…** button | Working through every waiting choice |

**Filter.** Media Library's list can be narrowed to items whose match state is
ambiguous through its **Filter** dialog; see
[Finding Media In Media Library](#finding-media-in-media-library). The
owner opens an item's **Media details** and chooses **Choose match**, which
opens the candidate choice, or **Reject match**. A rejected item's details offer
**Clear rejection**.

**Candidate choice.** A window dialog lists each candidate's poster, title,
and year beside the item's probed duration. Opening it calls TMDB for
nothing; **Show runtime** on a candidate asks TMDB for that one runtime. The
owner picks one, or chooses **None of these**, which rejects the match. When
no candidate fits, a **Not here? Search TMDB** box, starting from the name
the choice is about, with an optional year, searches TMDB's series or movies
as the item's hints place it, at one call per search, and lists what it
found with the same **Choose** and **Show runtime**; a chosen title needs
no earlier offer, since the owner's choice is the decision. **Correct
details…** opens the correction dialog for the item instead, for a title
TMDB does not know.

**Review matches.** The button sits beside **Filter** above the list and is
disabled while no item needs a choice; `<n>` counts steps, not files. It opens a window dialog that shows one
step at a time:

1. Each step is the candidate choice for one series folder, or for one movie
   file. Forty ambiguous `Doctor Who` episodes are one step, because choosing a
   series resolves every episode under that series folder.
2. The step offers each candidate, the TMDB search box, **Correct details…**,
   **None of these**, and **Skip**, which leaves the step's items unchanged
   for later. A correction applies to the step's own item, one file, while a
   choice resolves the whole series folder.
3. A choice, correction, or rejection commits immediately, then the next step
   shows. Closing the dialog keeps every commit already made.
4. After the last step the dialog shows `All done.` with counts of chosen,
   corrected, rejected, and skipped steps, and a **Close** button.

Steps are built when the dialog opens. A step whose items were resolved,
removed, or changed meanwhile is dropped without a commit. Disc-track files are
left out of the walk-through; [Disc-Track Mapping](#disc-track-mapping) resolves
them.

When a completed scan reports items needing a choice, its summary offers a
**Review matches…** button beside **OK** that opens the walk-through.

### Finding Media In Media Library

**Root match counts.** Each media root row shows a **Matches** column:
`<matched> of <items> matched`, followed by `<n> need your choice` and
`<n> failed lookups` when either is non-zero. `<items>` counts the root's
cataloged items, extras included. `<n> failed lookups` counts exactly the
items **Retry failed lookups** would look up, so the button is disabled when
it is 0, as it is while the root is disabled.

**Filter.** A **Filter…** button above the cataloged media list opens the
**Filter media** window dialog of filter sections. The owner checks values,
then **Apply** narrows the list; **Clear** removes every filter, and
**Cancel** or Escape keeps the applied filter. The button reads
`Filter (<n>)…`, counting the sections in use. Values within one section match any of them; sections
combine so an item must satisfy each. Filters combine with the text search,
and the list and its total page as before. The Collections program's **Add
from catalog** list offers the same **Filter…**, and its **Add all** adds
every item the search and filter keep.

| Section      | Values                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Match        | Matched, Needs your choice, Unmatched, Lookup failed, Rejected, Not looked up, File changed, Episode not listed on TMDB |
| Type         | Movie, TV episode, Extra, Unidentified                                                                                  |
| Availability | Available, Missing, Probe failed                                                                                        |
| Details      | Corrected by you, TMDB data expired, TMDB refresh failed                                                                |
| Collections  | In no collection                                                                                                        |
| Media root   | Each media root                                                                                                         |
| TV series    | Each cataloged series, as the automatic collection criterion lists them                                                 |
| Franchise    | Each cataloged franchise, likewise                                                                                      |
| Genre        | Each accepted genre, likewise                                                                                           |
| Tag          | Each tag in use, likewise                                                                                               |

**Unmatched** is an item TMDB answered without a match; **Lookup failed** is
one whose last lookup failed. **File changed** and **Episode not listed on
TMDB** are matched items the list labels so. An extra is never looked up, so
it is a type with no match state; **Unidentified** is any other item with no
movie or episode facts. **Corrected by you** counts a correction of a content
fact, never tags alone. A series, franchise, genre, or tag filter
matches the items the same collection criterion matches, so an episode whose
series the owner corrected to another name is in no TMDB series. An item
whose TMDB data expired keeps its series and franchise, but matches no genre
filter until its data is refreshed.

### Disc-Track Mapping

Disc rips such as MakeMKV output name files by track (`t_00.mkv`, `t_01.mkv`),
restart track numbers on each disc, usually but not always follow episode order,
and often include a play-all track and short extras. When a TMDB key is set,
Media Library offers **Map tracks to episodes**, a window dialog, from the
details of a disc-track file that has no match decision and no corrections. The
dialog needs TMDB for the series choice and episode runtimes; without a key the
user corrects each file's fields instead.

**Which files the dialog maps.** Every cataloged disc-track file under the same
series folder and season folder as the file it was opened from, across its disc
folders: `Show/Season 1/Disc 1/t_00.mkv` and `Show/Season 1/Disc 2/t_00.mkv`
map together, while `Show/Season 2/…` maps on its own. Files the owner already
mapped or corrected are listed too, so Apply can redo them.

1. The user searches TMDB for the series, starting from the folder's series name,
   picks one, and enters the season, starting from the folder's season number.
2. kraziTV proposes a mapping in disc-then-track order, continuing episode numbers
   across discs: Disc 1 `t_00` → E1, `t_01` → E2, and so on. Tracks without a
   disc folder are ordered by track number, then file name. Tracks left over
   after the season's last episode start as **Skip**.
3. Each row shows the track's probed duration beside TMDB's runtime for the
   proposed episode, so mismatches are visible.
4. Rows that do not fit start as **Skip**: a track shorter than a third of the
   folder's median track duration, and a play-all track whose duration is within
   5% of the sum of at least two other tracks on its disc, not counting short
   ones. A track with no probed duration is never pre-skipped.
5. The user changes any row to another episode or **Skip**, then chooses **Apply**.
   Nothing changes before Apply, and **Cancel** discards the proposal.
6. Apply links each mapped row to its TMDB episode as the owner's chosen match,
   and stores its series, season, and episode as a user correction, clearing any
   corrected title so TMDB's episode title shows. The mapping survives rescans,
   retries, refreshes, and expiry. Skipped tracks become extras, with their
   corrected title, series, season, and episode cleared: they stay in the catalog
   and are never matched as episodes. Tags are kept either way.

Runtime only shapes the proposal; it never accepts a match by itself, because
the user confirms every row. Apply reads TMDB before it writes, then commits
every row at once under write authority, revalidating each item, so a track
removed while the dialog was open is skipped. A newer match decision, correction,
or catalog fact changed while Apply waits for TMDB refuses the whole mapping
without changing any rows; the owner reopens it before applying again.

### Scan Progress, Retry, And Refresh

**Which items a scan looks up.** A rescan never searches again for an item whose
match state is settled, so a rescan of a matched library makes almost no calls.
A scan searches each movie title and year once, even when several files share
it.

| Item state                                 | Looked up on scan                                      |
| ------------------------------------------ | ------------------------------------------------------ |
| New, unmatched, or last lookup failed      | Yes                                                    |
| Matched, rejected, ambiguous, or corrected | No; state is kept, and ambiguous items keep candidates |
| Extra                                      | Never                                                  |

**The `enriching` phase.** A scan job's phases become
`discovering -> probing -> enriching -> committing -> completed`. Enriching starts
after every probe has settled, so lookups are grouped by series folder: one
search per series folder, not one per file. The phase is skipped when no TMDB key
is set or no item needs a lookup. A scan can be cancelled during enriching, and
cancellation leaves the catalog unchanged as it does during probing.

| Phase       | Status line                                                 | Progress bar                                     | Counts                |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------ | --------------------- |
| `enriching` | `Looking up media on TMDB…`, then `Last looked up: <title>` | Determinate: settled lookups / items needing one | `86 of 240 looked up` |

The other phases keep their [spec 0009](../../001-mvp/specs/0009-background-catalog-scans.md)
status lines. The `Scan completed.` summary adds matched, ambiguous, unmatched,
and lookup-error counts; when any item is ambiguous it adds
`<n> need your choice.` and a **Review matches…** button.

**Metadata-only retry.** A retry runs as a scan job of the root with only
`enriching -> committing`, shown in the same progress dialog and subject to the
same one-job-per-root rule. Its scope is one item, one folder, or every item in
the root whose last lookup failed. A retry looks up the items in its scope
regardless of match state, except corrected fields and extras, which it never
changes.

**Background refresh visibility.** The six-month refresh has no dialog. An
item's details show `TMDB data refreshed <date>`; an item whose provider facts
expired before a refresh succeeded shows `TMDB data expired. It will refresh when
TMDB is reachable.` Refresh never runs on a root while a scan or retry job for
that root is active, so their commits never interleave.

### Processing And Commit

Path hints are derived first, so a scan without a provider still produces fallback
titles. Wire enrichment explicitly after every probe settles and before candidate validation; operations
return normalized values and never write SQLite themselves. External calls use
the shared TMDB queue (see Rate limits), timeouts, and cancellation outside database write authority.
Restore discovery order before the scan's atomic catalog commit.

Item lookup errors are optional failures. An unexpected processing or validation
failure aborts the scan and leaves the previous catalog unchanged. Extend the
scan's cancellable phase through enrichment; cancellation before commit settles
started work and commits no partial catalog. Commit remains non-cancellable.

Metadata-only retry revalidates item existence and correction ownership when it
commits, so delayed results cannot resurrect removed media or erase newer edits.
It does not reconcile missing files. Notify collection maintenance only after
committed effective metadata changes; availability changes alone keep the existing
published-schedule policy.

## Data Model Impact

Add content facts, normalized content identities where needed, provider references,
match decisions, user corrections, and enrichment diagnostics/timestamps, including
when each item's provider facts were last fetched and the probed duration at
match time. Store the TMDB key as a
server-side secret outside the account row. Keep
technical availability separate from metadata completeness. Exact table shapes
remain an implementation design decision; do not build a generic evidence graph.

## Architecture Boundaries

| Area              | Impact                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| Schedule          | No direct writes; changed downstream collection inputs may require regeneration  |
| Playout timeline  | No selection changes; technical media facts remain authoritative for playability |
| Channel state     | Remains backend-derived from schedule and catalog snapshots                      |
| kraziBrain        | Receives normalized metadata projections only when ordering needs them           |
| SignalPackager    | No enrichment or matching responsibilities                                       |
| Provider adapters | Metadata lookup mapping stays isolated from scheduling and tuner exposure        |

`packages/media` owns persistence-free inspection and enrichment capabilities;
`apps/server` composes operations, stores results, and exposes administrative APIs.
Reuse the existing candidate, writer, scan job, and cancellation seams.

## Open Questions

None.

## Acceptance Criteria

- With enrichment disabled or unreachable, usable local media can still be scanned,
  manually collected, and broadcast.
- No route ever returns the TMDB key; a rejected key is never stored.
- Without a TMDB key, a scan makes no TMDB calls and records no enrichment errors.
- Without a TMDB key, the tray shows the TMDB icon; the balloon opens by itself
  only when a media root exists and the reminder is due, and **Remind me later**
  and **Don't remind me** hold for 7 days and for good in that browser.
- Provider-sourced facts are refreshed in the background or dropped before they
  are six months old, without a catalog scan; user corrections are kept.
- Lookups back off on HTTP `429` instead of failing the scan.
- A rescan looks up only new, unmatched, and failed-lookup items; matched,
  rejected, ambiguous, corrected, and extra items make no TMDB calls.
- A scan with a TMDB key reports an `enriching` phase between `probing` and
  `committing`; without a key, or with nothing to look up, it skips the phase.
- Cancelling during `enriching` leaves the catalog unchanged.
- The completed summary reports matched, ambiguous, unmatched, and lookup-error
  counts.
- A metadata-only retry runs as an `enriching -> committing` job scoped to an
  item, a folder, or a root's failed lookups, and never changes corrected fields.
- Background refresh never runs on a root while a scan or retry job for it is
  active, and each item shows when its TMDB data was last refreshed or that it
  expired.
- Ambiguous titles produce a visible choice rather than a silently accepted match.
- A title with several same-named results and no year hint, such as
  `Doctor Who` or `The Thing`, is ambiguous, never resolved by popularity;
  a series folder whose seasons only one of them lists, such as
  `The Office` with a season 9, is matched to that one.
- A year-hinted series whose dated result does not hold the folder's seasons
  is searched again without the year, so `Battlestar Galactica (2003)`
  matches the 2004 series.
- A series whose TMDB season lacks a file's episode number is still matched,
  with the file's numbers and no episode title, and Media Library says so.
- A season folder numbered past its TMDB count throughout is read as absolute
  numbering; one file numbered just past the season's end is not.
- Choosing a series for one episode resolves every other episode under the same
  series folder, across its season folders, to the same series, and a title
  the owner searched for can be chosen like an offered candidate.
- A correction on an item that needs a choice settles it, and the release
  year can be corrected like any other fact.
- Media Library filters its list by match state, type, availability,
  metadata details, collection membership, media root, TV series, franchise,
  genre, and tag, any of them together, and a
  series, franchise, genre, or tag filter matches what the same collection
  criterion matches.
- Each media root shows its matched, needing-choice, and failed-lookup counts,
  and **Retry failed lookups** is disabled when the root has none.
- **Review matches** shows one step per series folder or movie file, where
  the series folder is the outermost naming folder, so `Survivor/` with 44
  season folders is one step; commits each choice or correction as it is
  made, keeps earlier commits when closed early, and ends with chosen,
  corrected, rejected, and skipped counts.
- A bare `Series` folder is skipped; `Series 1` is a season folder.
- Map tracks to episodes is offered only when a TMDB key is set.
- A file whose name lacks the title, such as `Firefly/Season 1/s01e05.mp4`, is
  queried and displayed using its folder hierarchy.
- A generic or season folder name, or the media root, is never treated as a
  series or title; a country tag such as `(US)` is a hint, never part of the
  name; edition labels and copy numbers never reach a title.
- Release tokens are stripped: `Firefly (2002) [1080p BluRay x265]` is queried
  as series `Firefly`, year 2002.
- A file under an extras folder is never automatically matched as an episode or
  movie.
- A file under `Specials` carries a season 0 hint.
- Map tracks to episodes proposes disc-then-track order, pre-skips play-all and
  very short tracks, changes nothing before Apply, and links each applied row to
  its TMDB episode with a user correction that survives rescans; skipped tracks
  become extras that rescans and retries keep.
- A disc-track file such as `Some Show/t_01.mkv` is never automatically matched
  to an episode, and its track number never becomes an episode number.
- A corrected series, episode, or title survives rescans and metadata retries.
- Tags and themes come only from the user; TMDB keywords are never imported.
- kraziTV stores a poster reference, never an image file.
- A rejected match is not silently reapplied by a later scan.
- A file whose probed duration moves more than 2 seconds from its match-time
  duration keeps its match and corrections and is flagged for review; a duration
  change alone never resets a match.
- Lookup errors preserve accepted metadata and remain distinct from probe failures.
- Cancelled enrichment leaves the previous catalog unchanged and settles active work.
- A delayed retry cannot restore a removed item or overwrite a newer correction.
- Provider payloads never enter schedule generation, and metadata-only retry does
  not require ffprobe or change published guide entries directly.
