# Live App Access For Agents

Use this when an agent needs to see the owner's running kraziTV web app, not a
test server. It drives headless Chromium through Playwright against the dev
servers (`npm run dev` on `:3000`, `npm run dev:web` on `:5173`).

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

## Never

- Never retry a failed login. Wrong passwords trip the server's login
  throttle; stop and ask the owner.
- Never print, log, or commit the password or the saved storage state.
- This is the owner's real catalog and schedule. Look and navigate freely,
  but ask before any action that writes, such as saving a show, deleting
  media, or rebuilding a schedule.
