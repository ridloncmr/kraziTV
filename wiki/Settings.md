# Settings

kraziTV reads its settings from environment variables when it starts. With
Docker, pass them with `-e`. From source, put them in a `.env` file in the
top kraziTV folder, next to `.env.example`, which lists them all. Restart kraziTV after any
change.

Everything else, such as channels, collections, and the TMDB key, is set
in the web app and needs no restart.

| Setting                        | What it does                                                                                   | Default                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| `PUBLIC_BASE_URL`              | The address Plex and your browser use to reach kraziTV. See [The address](#the-address).       | `http://127.0.0.1:` and the port |
| `HOST`                         | The address kraziTV listens on. Use `0.0.0.0` to accept other devices. Docker sets this.       | `127.0.0.1`                      |
| `PORT`                         | The port kraziTV listens on                                                                    | `3000`                           |
| `KRAZITV_DATA_DIR`             | Where kraziTV keeps its database. From source that is `apps/server/data`; Docker uses `/data`. | `data`                           |
| `KRAZITV_PROGRAMMING_TIMEZONE` | The timezone rules and off-air times use, such as `America/New_York`                           | The computer's timezone          |
| `KRAZITV_DEVICE_ID`            | The tuner ID Plex sees. Change it only to run two copies of kraziTV on one Plex server.        | `4B5A5456`                       |
| `KRAZITV_TUNER_COUNT`          | How many channels Plex may watch at once, 1 to 64                                              | `2`                              |
| `FFMPEG_PATH`, `FFPROBE_PATH`  | The FFmpeg and ffprobe programs to use                                                         | The ones on `PATH`               |
| `FFMPEG_FONT_FILE`             | The font for the off-air and offline screens                                                   | Arial, or the system font        |
| `FFPROBE_TIMEOUT_MS`           | How long scanning one file may take, in milliseconds                                           | `30000`                          |
| `FFPROBE_CONCURRENCY`          | How many files are scanned at once, 1 to 32                                                    | `4`                              |
| `CORS_ORIGINS`                 | Only for people developing kraziTV; leave it alone                                             | `http://127.0.0.1:5173`          |

## The timezone

Rules say "8 PM" and off-air screens say "Programming resumes at 8:00 PM"
in the programming timezone. Set `KRAZITV_PROGRAMMING_TIMEZONE` to a
timezone name such as `Europe/London` or `America/Los_Angeles`
([full list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)).
Docker containers run on UTC unless told otherwise, so always set it there.
The dialog that creates or edits a rule names the timezone in use.

The Program Guide, on the other hand, shows times in your browser's
timezone. If the two differ, guide times and on-screen times will not
match.

## The address

Every address kraziTV gives Plex is built on `PUBLIC_BASE_URL`, and
kraziTV only accepts changes from a browser at that address. Open it there.
If you open kraziTV at another address, the logon screen links you to the
right one. Plex Setup warns you when the address is one only this computer
can reach.

---

**Next:** [Troubleshooting](Troubleshooting).
