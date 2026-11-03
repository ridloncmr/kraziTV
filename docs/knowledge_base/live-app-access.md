# Live App Access For Agents

Use this when an agent needs to see the owner's running kraziTV web app, not a
test server. It drives headless Chromium through Playwright against the dev
servers that `npm run dev` starts (the API on `:3000`, the web app on `:5173`).

## Setup

The owner puts the account password in `.env.agent` at the repo root. Git
ignores it through the `.env.*` rule.

```sh
echo 'KRAZITV_PASSWORD=...' > .env.agent
chmod 600 .env.agent
```

## Use

```sh
npm run live:screenshot
npm run live:screenshot -- --program "My Channels" --out data/live-app/channels.png
```

For anything beyond one screenshot, import `openLiveApp` from
`scripts/live-app/live-session.mjs` in a throwaway script and drive the
returned Playwright `page`.

- The session is saved in `data/live-app/storage-state.json` and reused until
  the server rejects it, so most runs do not log in at all.
- `KRAZITV_WEB_URL` and `KRAZITV_API_URL` override the default origins.

## Wiki and README screenshots use the demo library

The wiki and README never show the owner's library. Their screenshots come from a second
kraziTV, the demo, at `http://localhost:3100` with its own database under
`data/demo/`. Its media is placeholder title cards for public-domain shows
and films that TMDB matches. `localhost` keeps its session cookie apart from
the real app's on `127.0.0.1`.

```sh
npm run build                                   # the demo serves the build
node scripts/demo-library/make-media.mjs        # once: about 650 MB of cards
node scripts/demo-library/start.mjs             # leave running
TMDB_API_KEY=... node scripts/demo-library/seed.mjs   # once, on an empty data/demo/db
node scripts/live-app/wiki-screenshots.mjs     # wiki/images/
node scripts/live-app/readme-screenshots.mjs   # docs/images/, arranged desktop scenes
```

- The seed runs once. To start over, stop the demo, delete `data/demo/db`,
  start it, and seed again.
- `scripts/demo-library/library.mjs` lists the titles; the names at the top
  of both screenshot scripts are objects the seed creates. Change them together.
- Before each shot the script swaps the demo's media folder for `/media` and
  this computer's network addresses for `192.168.1.10`, so no machine detail
  shows.

## Never

- Never retry a failed login. Wrong passwords trip the server's login
  throttle; stop and ask the owner.
- Never print, log, or commit the password or the saved storage state.
- This is the owner's real catalog and schedule. Look and navigate freely,
  but ask before any action that writes, such as saving a show, deleting
  media, or rebuilding a schedule.
