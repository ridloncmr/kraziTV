// Starts the built kraziTV server with the kraziMorph preload, so Plex and
// the TV program receive the spike's output through the real tuner routes.
// Everything else comes from your `.env`, exactly as `npm start` would.
//
// Usage:
//   npm run build:node
//   KRAZIMORPH_MODE=auto node scripts/spikes/krazimorph/start-server.mjs
//
// Modes: off (today's behavior, the control), native, auto. See README.md.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const serverEntry = join(repoRoot, "apps", "server", "dist", "index.js");

if (!existsSync(serverEntry)) {
  process.stderr.write("Build first: npm run build:node\n");
  process.exit(1);
}

const server = spawn(
  process.execPath,
  ["--import", join(here, "preload.mjs"), serverEntry],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      KRAZIMORPH_MODE: "auto",
      KRAZIMORPH_CEILING: "1080",
      ...process.env,
    },
  },
);
server.on("exit", (code) => process.exit(code ?? 0));
