# Account Settings

kraziTV has one account: the person who administers it. Account Settings
is where you change its name, picture, and password, and where the TMDB key
lives.

![Account Settings](images/account-settings.png)

## Your name and picture

**Change my name** sets the name shown on the logon screen. **Change my
picture** picks one of the built-in pictures, which also serves as the
Account Settings icon on the desktop.

## Your password

**Change my password** asks for the current password and the new one, at
least eight characters. Every other browser is logged out when you change
it; the one you are using stays logged in.

A browser stays logged in for thirty days of use. **Log Off** on the Start
menu logs that browser out right away.

### If you forget it

Run this on the computer kraziTV runs on. kraziTV can keep running.

```bash
# Docker
docker exec -it krazitv node apps/server/dist/reset-password.js

# From source, in the kraziTV folder
npm run reset-password
```

It asks for the new password twice, replaces the old one, and logs every
browser out. It needs a real terminal, which is why the Docker command has
`-it`, and if kraziTV happens to be writing at that moment it asks you to
try again.

## TMDB

The TMDB key that lets kraziTV recognize your shows and movies lives here,
under **Set up TMDB**. [Set up TMDB](Set-Up-TMDB) walks you through getting
a free key from TMDB and adding it.

---

**Next:** [How programming works](How-Programming-Works).
