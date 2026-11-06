# Troubleshooting

## The logon screen says to open kraziTV at its own address

kraziTV only accepts changes from the address in `PUBLIC_BASE_URL`. Click
the link the screen offers, or set `PUBLIC_BASE_URL` to the address you
want to use and restart. See [Settings](Settings#the-address).

## A window says "Can't reach kraziTV"

A window reads "Can't reach kraziTV. Check that it is running, then press
Refresh." when kraziTV did not answer the browser: it is stopped, still
starting, or taking too long. The dot in the system tray turns amber at the
same time. Wait a moment for kraziTV to finish starting, then press the
window's **Refresh** button or refresh the page in your browser. If it keeps
saying so, start kraziTV again on its computer
or in Docker (see [Install](Install)) and make sure the address in your
browser is the one in [Settings](Settings#the-address).

## Plex cannot reach kraziTV

Open Plex Setup. A yellow box means kraziTV is only reachable from its own
computer. Add the settings it lists and restart. If there is no box, make
sure the Plex server itself, not just your browser, can reach the tuner
base URL. See [Connect Plex](Connect-Plex).

## A channel says "Nothing is scheduled right now"

The channel has nothing it can play. Open its Properties:

- **Lineup** empty? Add shows.
- **Preview** says a show is skipped? Its collection is empty, or its
  files are missing or [too short](Media-Library#scanning). Check them in
  Media Library.
- Every show marked **Rules only** and no rule applies right now? Add a
  regular show, or a rule for now.

## A channel I added is not in Plex

Plex only reads the channel list when asked. See
[Changing channels later](Connect-Plex#changing-channels-later).

## Plex stutters or buffers

Each channel being watched is a full video conversion. Watch fewer channels
at once, or run kraziTV on a faster computer. See
[What you need](Install#what-you-need).

## Guide times are hours off

The Program Guide uses your browser's timezone and rules use kraziTV's. If
they differ, set `KRAZITV_PROGRAMMING_TIMEZONE`. See
[Settings](Settings#the-timezone).

## A scan is slow or looks stuck

A first scan reads every file, which takes a while on a large library or a
slow network share. The progress dialog shows the last file it read. You
can close the window; the scan keeps going.

## A scan finds no video files

When nothing was found, the scan's dialog reads "No video files found."
and lists the extensions kraziTV looks for, such as `.mkv` and `.mp4`, in
the folder and its subfolders.

- Check that the media root is the folder holding your movies or shows, not
  an empty or unrelated one.
- Disc images such as `.iso` and disc folders are not read. Rip them to
  `.mkv` first; [Naming your files](Naming-Your-Files) shows how to name
  the rips.
- With Docker, kraziTV sees only the folders you hand it with `-v`, under
  `/media`. Choose the root there with **Add media root…**, such as
  `/media/movies`. See [Your media folders](Install#your-media-folders).

## TV says "No signal"

Either the channel is off the air, as above, or the browser cannot play
the stream. Try it in Plex, or in a desktop browser.

## Viewers see "Programming offline"

The program's file is missing or could not be played. Find it in Media
Library; **Missing** or **Could not be read** says what is wrong. The
channel moves on at the next program. See [Off air and other
screens](Off-Air).

## The guide shows "Off air"

That is planned time around a [special](Specials) that no whole program
fits into. It is not an error. Move the special earlier, or let it cut in,
to shrink the gap.

## My shows are not matched

- No TMDB key: follow [Set up TMDB](Set-Up-TMDB), then scan again.
- **Needs your choice**: click **Review matches** in Media Library and
  answer the questions.
- **Unmatched** or wrong: check the folder names against [Naming your
  files](Naming-Your-Files), fix them, and scan again. Or open the file's
  Details and **Correct details…**.
- **Lookup failed**: open the file's Details. "TMDB could not be reached;
  kraziTV will try again." means TMDB was unreachable: use **Retry failed
  lookups** on the root. "TMDB rejected the key. Check it in Account
  Settings." means TMDB no longer accepts your key: paste a new one in
  [Set up TMDB](Set-Up-TMDB#changing-or-removing-the-key), then use
  **Retry failed lookups**. The same sentence shows when choosing a match
  fails. Under **Refresh error** on a matched file it means a background
  refresh failed: the match stays, and kraziTV tries again on its own every
  hour and after every scan, so the error clears once TMDB answers.

## Rules fire at the wrong hour

The programming timezone is wrong, usually because kraziTV runs in Docker
on UTC. Set `KRAZITV_PROGRAMMING_TIMEZONE`. See [Settings](Settings#the-timezone).

## I forgot my password

Run the reset command on the kraziTV computer. See [Account
Settings](Account-Settings#if-you-forget-it).

## A collection cannot be deleted

A channel plays it, or a special uses it. Remove it from the channel's
lineup, or cancel the special, first.

## A message says to check the kraziTV log

kraziTV hit a problem it could not recover from, and its log says what. With
Docker, run `docker logs krazitv` (the name [Install](Install#with-docker)
gives the container). From source, the log is the terminal running
`npm start --workspace @krazitv/server`.

## Something else

[Open an issue](https://github.com/ridloncmr/kraziTV/issues) with what you
did, what you expected, and what happened.
