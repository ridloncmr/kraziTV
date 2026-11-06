// Runs a second kraziTV on port 3100 with its own database under data/demo,
// beside the owner's real one, so wiki screenshots never show a personal
// library. Needs `npm run build` first; it serves the built web app.
//
// Usage:
//   node scripts/demo-library/start.mjs

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_TIMEZONE, DEMO_URL } from "./library.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Explicit values win over the real install's .env, which the server also
// reads but never lets override what is already set. Detached, so Ctrl+C
// in the terminal reaches only this script, which signals the server once.
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: repoRoot,
  stdio: "inherit",
  detached: true,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3100",
    PUBLIC_BASE_URL: DEMO_URL,
    KRAZITV_DATA_DIR: join(repoRoot, "data", "demo", "db"),
    // A tuner ID of its own, so Plex never mistakes it for the real tuner.
    KRAZITV_DEVICE_ID: "4B5A5444",
    KRAZITV_PROGRAMMING_TIMEZONE: DEMO_TIMEZONE,
  },
});
// Stopping this script stops the server too, so port 3100 comes free; the
// script exits once the server has closed. Detached, the server no longer
// hears the terminal, so a closed terminal (SIGHUP) or Ctrl+\ (SIGQUIT)
// reaches it as SIGTERM, the one besides SIGINT its graceful close handles.
// A second signal meets the server's default handler, which ends it at once.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"])
  process.on(signal, () =>
    server.kill(signal === "SIGINT" ? "SIGINT" : "SIGTERM"),
  );
server.on("exit", (code) => process.exit(code ?? 0));
