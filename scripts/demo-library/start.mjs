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
// reads but never lets override what is already set.
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: repoRoot,
  stdio: "inherit",
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
server.on("exit", (code) => process.exit(code ?? 0));
