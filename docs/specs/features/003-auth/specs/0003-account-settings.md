# Account Settings

Status: Draft

This spec adds an **Account Settings** desktop program for changing the
account's password, display name, and avatar. It builds on
[0001-accounts-and-sessions](0001-accounts-and-sessions.md) and
[0002-logon-screen](0002-logon-screen.md).

## Problem

After setup, the only way to change the password is the host CLI, and the
display name and avatar cannot change at all.

## Goals

- Change the password, given the current one.
- Change the display name.
- Pick an avatar from a built-in set.

## Non-goals

- Uploading a custom picture.
- Changing anything about other accounts; there are none.
- Deleting the account. The host CLI and database cover a full reset.

## User-Facing Behavior

- **Account Settings** opens from the desktop and Start, like other desktop
  programs. It shows the current avatar and display name at the top, followed
  by three task links in the XP User Accounts style: **Change my name**,
  **Change my picture**, **Change my password**.
- **Change my name**: one text box, **Change Name** and **Cancel**.
- **Change my picture**: a grid of the built-in avatars with the current one
  selected, **Change Picture** and **Cancel**.
- **Change my password**: **Current password**, **New password**, **Confirm new
  password**, **Change Password** and **Cancel**. A wrong current password
  shows `The password you typed is incorrect.` and changes nothing.
- After a password change, the browser stays logged in and every other session
  ends.
- The logon screen shows the new name and picture the next time it appears.

## Technical Behavior

### Routes

All are gated.

| Route                   | Body                               | Behavior                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /account`          | —                                  | Returns `{ displayName, avatarId }`.                                                                                                                                                                                               |
| `PATCH /account`        | `{ displayName?, avatarId? }`      | Updates the given fields. Unknown `avatarId` answers `400 unknown_avatar`.                                                                                                                                                         |
| `PUT /account/password` | `{ currentPassword, newPassword }` | Checks the current password, replaces the hash, and deletes every session except the request's. Wrong current password answers `400 invalid_password`; the attempt counts toward [0001](0001-accounts-and-sessions.md)'s throttle. |

- Display name: trimmed, 1–40 characters.
- New password: the same rules as setup.

### Built-in avatars

- [0002](0002-logon-screen.md#built-in-avatars) defines the set and ships its
  drawings in `apps/web/src/branding/avatars/`.
- The server holds the same ID list to validate `avatarId`. The ID list is the
  only thing both sides share; the web app owns the drawings.
- The first ID, `duck`, is the default for a new account.

## Data Model Impact

None beyond [0001](0001-accounts-and-sessions.md). `accounts.updatedAt` changes
with each edit.

## Architecture Boundaries

- Account routes live in `apps/server/src/auth/`; the program lives in
  `apps/web/src/account-settings/`.
- Changing the account never affects channels, schedules, or streams.

kraziTV check: no effect on the schedule, playout timeline, channel state,
kraziBrain, SignalPackager, or provider adapters.

## Open Questions

- Should the avatar ID list live in a small shared package so web and server
  cannot drift, or is a server-side list plus a web test that every ID has a
  drawing enough? KISS favors the test.

## Acceptance Criteria

- Changing the name or picture updates `GET /auth/state` and the logon screen.
- An unknown avatar ID answers `400 unknown_avatar`.
- A password change with the wrong current password answers
  `400 invalid_password` and changes nothing.
- A successful password change keeps the current session, ends every other
  session, and the new password logs in while the old one does not.
- Every avatar ID the server accepts has a drawing in the web app.
