// Opens the demo kraziTV for the screenshot scripts, and hides what still
// shows of the owner's computer before each shot.

import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openLiveApp } from "../live-app/live-session.mjs";
import { DEMO_PASSWORD, DEMO_TIMEZONE, DEMO_URL } from "./library.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Opens the demo's desktop logged in, with a session file of its own, in
 * the demo's timezone so no clock shows the owner's.
 */
export function openDemoApp({ width, height }) {
  return openLiveApp({
    width,
    height,
    timezoneId: DEMO_TIMEZONE,
    app: {
      webUrl: DEMO_URL,
      apiUrl: DEMO_URL,
      password: () => DEMO_PASSWORD,
      storageStatePath: join(repoRoot, "data", "demo", "storage-state.json"),
    },
  });
}

// The demo runs on the owner's computer, so its media folder and this
// computer's network addresses would show. Shots swap them for the example
// values the docs use elsewhere. The folder is resolved, because a git
// worktree links `data/demo` to the main checkout's, whose path the demo's
// database holds.
const machineValues = [
  [realpathSync(join(repoRoot, "data", "demo", "media")), "/media"],
  ...Object.values(networkInterfaces())
    .flat()
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => [address.address, "192.168.1.10"]),
];

/** Replaces machine values in the page's text and form fields; call before every shot. */
export function hideMachineValues(page) {
  return page.evaluate((pairs) => {
    // This runs in the page, where these browser globals exist.
    const { document, NodeFilter } = globalThis;
    const swap = (text) =>
      pairs.reduce((result, [from, to]) => result.split(from).join(to), text);
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const swapped = swap(node.nodeValue);
      if (swapped !== node.nodeValue) node.nodeValue = swapped;
    }
    for (const field of document.querySelectorAll("input, textarea")) {
      field.value = swap(field.value);
    }
  }, machineValues);
}
