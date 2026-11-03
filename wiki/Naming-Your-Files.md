# Naming your files

kraziTV reads file and folder names to work out what each file is, then
confirms it on TMDB. The better the names, the fewer questions it asks. If
your library already follows Plex's conventions, you are done.

## The layout that works best

```text
/media/
  TV Shows/
    Firefly (2002)/
      Season 1/
        Firefly - S01E01 - Serenity.mkv
        Firefly - S01E05E06.mkv
      Specials/
        Firefly - S00E01.mkv
      Featurettes/
        making-of.mkv
    Doctor Who (2005)/
      Season 1/
        s01e01.mkv
  Movies/
    Alien (1979)/
      Alien (1979).mkv
    The Thing (1982)/
      movie.mkv
```

- **The show folder names the show.** It is the first folder below the
  media root that is not a generic name like `TV Shows`. Every episode under
  it belongs to that show, however the season folders are named.
- **Put the year in the folder name** whenever a title has been reused.
  `Doctor Who (2005)` matches at once; a bare `Doctor Who` matches only if
  the seasons you have fit one of them, and otherwise kraziTV asks.
- **Season folders** can be `Season 1`, `Season 01`, `S1`, or the same
  thing in another language. `Specials` is season 0. A bare number is not
  a season, because some shows are called `24`.
- **Episode numbers** can be `S01E05`, `1x05`, or `Episode 5`. A file
  covering two episodes is `S01E05E06` or `S01E05-E06`.
- **Movies** can be loose files named `Title (Year).mkv`, or sit in a
  folder named after the movie when the file is named after the movie too,
  or generically as `movie.mkv`, `film.mkv`, or `title.mkv`. Any other file
  name is taken as the title.
- **Extras** go in a folder named `Featurettes`, `Deleted Scenes`,
  `Trailers`, `Behind the Scenes`, `Interviews`, `Shorts`, or `Extras`,
  inside the show's or movie's folder. kraziTV catalogs them but never
  confuses them with episodes.

## What kraziTV ignores

Resolution, source, and codec tags such as `1080p`, `BluRay`, `x265`, and
anything in square brackets are stripped before searching. A country tag
such as `(US)` tells remakes apart. `Director's Cut` and similar edition
labels are dropped.

Folders named `TV`, `TV Shows`, `Movies`, `Anime`, `Cartoons`, `Kids`,
`4K`, `Downloads`, and other generic names are skipped, so they can sit
between the media root and your shows without becoming a show themselves.
A personal name like `My Stuff` is not on that list, so a file beneath it
that does not carry its show's name, such as `s01e01.mkv`, is taken for an
episode of a show called My Stuff. Keep such folders out of the path, or
name every file with its show.

## Things that need a hand

- **Disc rips** named `t_00.mkv` or `title_t00.mkv`, as MakeMKV names
  them, cannot be identified by name. Keep each disc in a `Disc 1`, `Disc
2` folder, then open a track's details and use **Map tracks to
  episodes…**.
- **Episodes TMDB counts differently**, such as a two-parter TMDB lists as
  one episode, show as **Matched; episode not listed on TMDB**. They still
  air in episode order using the numbers in the file name.
- **A wrong show folder** misleads every episode under it. When kraziTV
  asks, one choice in **Review matches** fixes them all. When it matched
  the wrong show outright, rename the folder and scan again.

---

**Next:** back to [Media Library](Media-Library) to scan again, then
[Collections](Collections).
