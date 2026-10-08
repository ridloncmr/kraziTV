# Logon Screen

Status: Draft

This spec puts an XP-style setup and logon screen in front of the desktop
shell and makes the web app send its session cookie. It builds on the API in
[0001-accounts-and-sessions](0001-accounts-and-sessions.md) and uses **logon
screen** as `GLOSSARY.md` defines it.

## Problem

Once the server gates its routes, the web app gets `401` for everything and has
no way to set up an account or log in. The desktop shell's Start menu also
promises "no pretend OS or authentication actions"
([0008-web-admin](../../001-mvp/specs/0008-web-admin.md)), which this feature
changes.

## Goals

- Show a first-run setup screen when no account exists.
- Show the logon screen when the browser has no valid session.
- Log in by clicking the user tile and entering the password.
- Return to the logon screen whenever the server answers `401`.
- Add **Log Off** to the Start menu.

## Non-goals

- More than one user tile, guest access, or switching users.
- Password hints. kraziTV has no safe place to show one.
- A **Turn off** control. The browser has nothing to turn off.
- Reproducing Microsoft artwork, logos, wallpaper, or fonts; 0008's rule
  stands.
- Account settings ([0003](0003-account-settings.md)).

## User-Facing Behavior

### What the app shows on load

The app calls `GET /auth/state` after the boot screen:

| State                      | Screen                                      |
| -------------------------- | ------------------------------------------- |
| `setupRequired`            | Setup screen                                |
| account, not authenticated | Logon screen                                |
| authenticated              | Desktop shell                               |
| server unreachable         | The boot screen's existing connection error |

### Logon screen

- Full-window blue gradient background with a lighter band across the middle,
  thin highlight lines above and below it, and kraziTV branding on the left
  half, in the spirit of the XP Welcome screen. Original artwork and CSS only.
- The right half shows one user tile: the account's avatar and display name.
- Clicking the tile, or pressing Enter while it has focus, expands it to show a
  password box and a green arrow button. Focus moves to the password box.
- Submitting logs in. While the request runs the box and button are disabled.
- `invalid_password` shows a balloon tip under the box,
  `Did you forget your password? Please type your password again. Be sure to
use the correct uppercase and lowercase letters.`, and clears the box.
- `too_many_attempts` shows a balloon tip with the remaining wait, counts it
  down, and disables the box until it reaches zero.
- A lower-right line reads `After you log on, you can change your password or
picture in Account Settings.`

### Setup screen

- The same background with a single panel titled `Welcome to kraziTV`.
- Fields: **Your name**, **Password**, **Confirm password**.
- Client-side checks mirror the server: name required, password 8–256
  characters, both passwords match. The server's answer is final.
- **Next** creates the account and opens the desktop shell directly.

### While logged in

- The Start menu gains **Log Off** at the bottom. It opens a small window
  dialog, `Log Off kraziTV`, with **Log Off** and **Cancel**. Log Off calls
  `POST /auth/logout`, closes every desktop program, and shows the logon
  screen.
- When any request answers `401`, the app closes every desktop program and
  shows the logon screen. Desktop shell state is transient
  ([0008](../../001-mvp/specs/0008-web-admin.md)), so nothing needs saving;
  unsaved form input is lost, as it would be on reload.

## Technical Behavior

- `apiRequest` sends `credentials: "include"` on every request.
- `apiRequest` reports a `401` to one auth state holder at the app root; that
  holder switches the app to the logon screen. Individual programs do not
  handle `401` themselves.
- The logon and setup screens live in a new `apps/web/src/logon/` domain. Their
  calls go through the existing `http/` client.
- Avatars come from the built-in set [0003](0003-account-settings.md) defines.
  Until 0003 lands, the default avatar is the only one.

## Data Model Impact

None beyond [0001](0001-accounts-and-sessions.md).

## Architecture Boundaries

- The browser decides what to show, never what is allowed. The server's gate
  is the only authority.
- No session token is readable by JavaScript; the cookie is `HttpOnly`.

kraziTV check: no effect on the schedule, playout timeline, channel state,
kraziBrain, SignalPackager, or provider adapters.

## Open Questions

- Should the logon screen also appear after a period of inactivity, like XP's
  lock on resume? The session already lasts 30 days, so this would be a UI
  lock only; deferred unless asked for.

## Acceptance Criteria

- With no account, the app shows the setup screen, and completing it opens the
  desktop shell.
- With an account and no session, the app shows the logon screen with the
  account's avatar and display name.
- A correct password opens the desktop; a wrong one shows the balloon tip and
  clears the box; throttling shows a countdown and disables the box.
- Log Off ends the session and returns to the logon screen.
- A `401` from any program's request returns the app to the logon screen.
- The setup and logon screens are keyboard-operable: Tab reaches the tile,
  Enter opens it, and Enter submits the password.
