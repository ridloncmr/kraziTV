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
- Leave the desktop shell whenever the server answers `401`.
- Add **Log Off** to the Start menu.
- Ship the built-in avatar artwork the logon screen and Account Settings show.

## Non-goals

- More than one user tile, guest access, or switching users.
- Password hints. kraziTV has no safe place to show one.
- A **Turn off** control. The browser has nothing to turn off.
- Reproducing Microsoft artwork, logos, wallpaper, or fonts; 0008's rule
  stands.
- Account settings, including choosing an avatar
  ([0003](0003-account-settings.md)).

## User-Facing Behavior

### What the app shows on load

The boot screen calls `GET /auth/state` and stays up until it answers:

| State                      | Screen        |
| -------------------------- | ------------- |
| `setupRequired`            | Setup screen  |
| account, not authenticated | Logon screen  |
| authenticated              | Desktop shell |
| server unreachable         | Boot screen   |

When the request fails, the boot screen shows `kraziTV can't reach its
server.` with a **Retry** button and retries on its own every 10 seconds. The
desktop shell never opens without an answer, because only the server can say
whether the browser is logged in.

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
- Client-side checks mirror the server: name 1–40 characters after trimming,
  password 8–256 characters, both passwords match. The server's answer is
  final.
- **Next** creates the account and opens the desktop shell directly.
- If the server answers `409 already_set_up`, because another browser finished
  setup first, the app reads `GET /auth/state` again and shows the logon
  screen.

### While logged in

- The Start menu gains **Log Off** at the bottom. It opens a small `Log Off
kraziTV` confirmation centered over the whole desktop, with **Log Off** and
  **Cancel**. It belongs to the desktop shell, not to a desktop program, so it
  is not a window dialog. Log Off calls `POST /auth/logout`, closes every
  desktop program, and shows the logon screen.
- If the logout request fails, the confirmation stays open with `kraziTV
couldn't log off. Check the connection and try again.` and the desktop stays
  open. The app never shows the logon screen while the server may still honor
  the session.
- When any request made from the desktop shell answers `401`, the app closes
  every desktop program, reads `GET /auth/state` again, and shows the screen it
  names: the logon screen, or the setup screen if the account no longer
  exists. Desktop shell state is transient
  ([0008](../../001-mvp/specs/0008-web-admin.md)), so nothing needs saving;
  unsaved form input is lost, as it would be on reload.
- On the logon and setup screens a `401` is only that screen's answer:
  `invalid_password` shows the balloon tip and never resets the screen.

## Technical Behavior

- `apiRequest` sends `credentials: "include"` on every request.
- `ApiError` gains the response's HTTP `status`. `apiRequest` reports every
  `401` to one auth state holder at the app root. The holder acts only while
  the desktop shell is showing; individual programs do not handle `401`
  themselves.
- The app root owns the boot screen, the `GET /auth/state` call, and the choice
  of screen. `DesktopShell` no longer runs the boot sequence; it renders only
  once the browser is authenticated, and keeps its tray connection indicator.
- The logon and setup screens live in a new `apps/web/src/logon/` domain. Their
  calls go through the existing `http/` client.
- In development, serve the web app and the API on the same host name, such as
  `127.0.0.1` for both. The session cookie is `SameSite=Strict`, so a page on
  `localhost:5173` calling `127.0.0.1:3000` never sends it.

### Built-in avatars

- Eight original SVG drawings in `apps/web/src/branding/avatars/`, in the same
  dimensional vector style and gradients as the program icons, framed as a
  rounded square tile with a white border like an XP user picture. No
  Microsoft artwork.

  | ID          | Picture                                      |
  | ----------- | -------------------------------------------- |
  | `duck`      | A rubber duck; the default for new accounts  |
  | `crt-tv`    | A boxy CRT television with rabbit-ear aerial |
  | `antenna`   | A rooftop TV antenna against a blue sky      |
  | `remote`    | A chunky remote control                      |
  | `film-reel` | A film reel                                  |
  | `popcorn`   | A striped popcorn bucket                     |
  | `guitar`    | An electric guitar                           |
  | `chess`     | A chess knight                               |

- The web app owns the drawings and their ID list. An `avatarId` with no
  drawing shows `duck`, so a newer server never breaks the logon screen.
- The server keeps only `DEFAULT_AVATAR_ID`. Validating chosen IDs belongs to
  [0003](0003-account-settings.md).

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
- A wrong password on the logon screen shows the balloon tip and does not
  reset the screen.
- A `409 already_set_up` on the setup screen leads to the logon screen.
- The setup screen refuses a name over 40 characters before sending it.
- With the server unreachable, the boot screen shows the connection message
  and **Retry**, and opens the right screen once the server answers.
- A failed logout keeps the desktop open and shows the error in the
  confirmation.
- Each built-in avatar ID has a drawing, and an unknown ID draws `duck`.
- The setup and logon screens are keyboard-operable: Tab reaches the tile,
  Enter opens it, and Enter submits the password.
