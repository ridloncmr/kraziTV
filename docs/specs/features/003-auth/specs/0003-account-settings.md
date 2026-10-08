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
  programs. Its icon is the account's current avatar tile, as XP's Start menu
  shows the user picture. It shows the current avatar and display name at the
  top, followed by three task links in the XP User Accounts style: **Change my
  name**, **Change my picture**, **Change my password**.
- **Change my name**: one text box, **Change Name** and **Cancel**.
- **Change my picture**: a grid of the built-in avatars with the current one
  selected, **Change Picture** and **Cancel**.
- **Change my password**: **Current password**, **New password**, **Confirm new
  password**, **Change Password** and **Cancel**. A wrong current password
  shows `The password you typed is incorrect.` and changes nothing. While the
  login throttle is active, the dialog shows the remaining wait the way the
  logon screen does and does not check the password.
- After a password change, the browser stays logged in and every other session
  ends.
- The logon screen shows the new name and picture the next time it appears.

## Technical Behavior

### Routes

All are gated.

| Route                   | Body                               | Behavior                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /account`        | `{ displayName?, avatarId? }`      | Updates the given fields. Unknown `avatarId` answers `400 unknown_avatar`.                                                                                                                                                                                                                                            |
| `PUT /account/password` | `{ currentPassword, newPassword }` | Checks the current password, replaces the hash, and deletes every session except the request's. Wrong current password answers `400 invalid_password`; the attempt counts toward [0001](0001-accounts-and-sessions.md)'s throttle, and while it is active the route answers `429 too_many_attempts` without checking. |

- Account Settings reads the current name and avatar from `GET /auth/state`,
  which the web app already loads; there is no separate read route.
- `400 invalid_password` is deliberate: a `401` would make the web app leave
  the desktop.
- Display name: trimmed, 1–40 characters.
- New password: the same rules as setup.

### Built-in avatars

- [0002](0002-logon-screen.md#built-in-avatars) defines the set and ships its
  drawings in `apps/web/src/branding/avatars/`.
- The server holds the same ID list as `AVATAR_IDS` in
  `apps/server/src/auth/avatars.ts` to validate `avatarId`. The ID list is the
  only thing both sides share; the web app owns the drawings.
- No shared package: a web test checks that every server ID has a drawing,
  which is enough to stop drift for an eight-item list.
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

None.

## Acceptance Criteria

- Changing the name or picture updates `GET /auth/state` and the logon screen.
- An unknown avatar ID answers `400 unknown_avatar`.
- A password change with the wrong current password answers
  `400 invalid_password` and changes nothing.
- A successful password change keeps the current session, ends every other
  session, and the new password logs in while the old one does not.
- While the login throttle is active, a password change answers
  `429 too_many_attempts` without checking the password; a successful change
  resets the count.
- Every avatar ID the server accepts has a drawing in the web app.
