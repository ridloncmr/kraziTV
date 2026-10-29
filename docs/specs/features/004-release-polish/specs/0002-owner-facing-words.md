# Spec 0002: Owner-Facing Words

Status: In Development

## Intent

Every word the owner reads is in owner vocabulary, chosen by the web app
(decision 1). The server reports what happened with a code and structured
details; it never writes a sentence the owner will see, and never puts an ID
in one. Code and docs keep the glossary's terms; the screens keep the
glossary's labels (Show, Wheel, Special, Delete).

## Behavior

### Refusals

- Every API refusal is `{ error: { code, message, ...details } }` as today.
  `message` is for logs and tests. Field-level failures carry the offending
  field name in `details`, not a Zod printout. Refusals that concern another
  object carry its ID in `details`, never in `message`.
- The web app maps each code it can meet to one owner sentence that says what
  to change: a bad channel number says what a channel number looks like; a
  Special set in the past says so in those words; an overlap names the other
  Special by its airtime, not an ID.
- A code the web app does not know still shows, so nothing is silently lost.

### Labels and summaries

- Media item status reads **Available**, **Missing**, **Could not be read**
  everywhere it appears; picker and member rows omit the word when the item is
  available, and show the file name rather than the full path.
- The collection status strip says what can air and why the rest cannot:
  "Nothing to air yet, add media below." when empty, otherwise
  "12 of 14 can air (1 missing, 1 too short)". The status endpoint reports the
  missing and too-short counts.
- The scan summary uses the same words the match review uses: Files found,
  Could not be read, Missing, Identified on TMDB, Need your choice, Not
  identified, Lookup failed.
- The Preview tab's lines read as a listing: time, show, what plays. A skip
  names the show and the reason. "Normal rotation" appears only when a rule is
  also in play; round, cooldown, assignment, and member never appear.
- Plex Setup's steps say "add a show on its Lineup tab", separate "set" from
  the setting name, and mention the Docker `-e` form beside the `.env` file.

## Acceptance Targets

- A server test shows `invalid_request` details naming the field and no `✖`
  in any message; reservation refusals carry IDs only in details.
- A web test per mapped code renders the owner sentence.
- A test renders `probe_failed` as "Could not be read" in the library, the
  picker, and the member list.
- A test shows a collection with one missing and one too-short member reading
  "0 of 2 can air (1 missing, 1 too short)".
- Grepping `apps/web/src` for `assignment`, `reservation`, `regenerate`,
  `revision`, `entry`, or `probe_` finds no user-visible string.

## Out Of Scope

- Renaming codes, routes, or glossary terms.
- Translating anything.
