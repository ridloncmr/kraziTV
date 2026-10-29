# Spec 0001: First-Run Flow

Status: Implemented

## Intent

A first-time owner walks from logon to a channel playing in TV without
stopping to ask what to do next. Every screen on that path either does the
next thing or names it with a button. Property sheets look and save the way
XP sheets did.

The audit found two blockers on this path: after adding a media root nothing
offers a scan, and a new owner who starts at My Channels reaches "The catalog
has no media yet." with no way on. The rest of this spec removes the smaller
stalls around them.

## Behavior

### Scanning

- After a media root is added, kraziTV asks whether to scan it now, defaulting
  to yes, and opens the scan progress dialog when the owner agrees.
- A root that was never scanned shows a raised **Scan** button in its row, not
  only the row menu entry.

### Empty states carry their next step

- The show picker's "There are no collections yet." and "The catalog has no
  media yet." end with an **Open Media Library** button.
- My Channels, when the catalog is empty, says to add media in Media Library
  first and offers the same button.
- The Program Guide's and Live Monitor's "No channels yet." end with
  **Open My Channels**, as TV's already does.
- The Lineup tab's "No shows yet." contains **Add shows…**.
- All of these open the program through the host's `openProgram` callback
  (decision 2).

### TMDB setup

- The Set up TMDB task says the token is free, names where it comes from on
  TMDB's site, and links there. The TMDB logo links to TMDB.

### The rebuild question (decision 4)

- When a lineup write changes what airs on a channel with no airing program
  (nothing, or filler), the write applies and no dialog appears.
- When a program is airing, the dialog appears as today, defaults to **Let it
  finish**, keeps the disconnect warning, and is worded for owners: it names
  the program and says what happens to viewers. It never says round,
  cooldown, assignment, or member.
- Programming spec 0004's rebuild paragraph is amended to say this. ADR 0003
  and ADR 0015 are unchanged: kraziTV still never interrupts on its own.

### Adding shows

- The Add shows dialog leads with the search. "Add as: Separate shows / A
  wheel" appears only once two or more items are picked, above Next.
- **Add all** in the collection editor confirms when it would add more than
  one page of results, naming the count and the collection.

### Property sheets (decision 8)

- The channel's General tab and the show properties dialog share one footer:
  OK, Cancel, Apply at the bottom right. Apply is enabled only when a field
  changed. Closing with changes asks, as windows already do.
- The collection editor keeps its sticky save bar.

### Desktop chrome

- A window caption that does not fit ends in an ellipsis.
- A row badge never touches the text before it.
- Window captions use Trebuchet MS, as Luna did.
- My Channels' Watch / Properties / Disable / Delete bar stays in view when
  the list is longer than the window.
- The New channel dialog explains what the channel number is for.
- TV's "Tuning…" message fades out instead of vanishing when the picture
  starts; under reduced motion it still fades, since nothing moves.

## Acceptance Targets

- A jsdom test walks: add root, accept the scan prompt, see the scan dialog.
- A jsdom test for each empty state clicks its button and sees the program
  open through the fake host.
- A test adds the first show to a channel with nothing airing and sees no
  dialog; another adds a show while a program airs and sees the dialog with
  **Let it finish** selected.
- A test changes a name on the General tab and sees Apply enable, then Apply
  save and disable again.
- The browser suite's first-run walk reaches TV without opening a row menu.

## Out Of Scope

- Any new programming behavior; which entries regenerate is unchanged.
- Phone width (decision 7).
