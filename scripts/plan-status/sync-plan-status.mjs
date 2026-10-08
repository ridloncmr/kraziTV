// Regenerates the progress block in every implementation plan and the plan
// list in `docs/implementation_plan/README.md` from ticket Status blocks.
// Plans live in feature folders that mirror `docs/specs/features/`, such as
// `docs/implementation_plan/001-mvp/0002-media-catalog.md`.
//
// Usage:
//   node scripts/plan-status/sync-plan-status.mjs          Write generated blocks.
//   node scripts/plan-status/sync-plan-status.mjs --check  Exit non-zero if stale.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

import {
  INDEX_END,
  INDEX_START,
  PLAN_END,
  PLAN_START,
  parseTickets,
  renderIndexBlock,
  renderPlanBlock,
  upsertBlock,
} from "./plan-progress.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const planRoot = join(repoRoot, "docs", "implementation_plan");
const indexFile = join(planRoot, "README.md");
const PLAN_FILE = /^\d{4}-.+\.md$/;
const FEATURE_FOLDER = /^\d{3}-.+$/;

/**
 * Formats with the repository Prettier config so generated output already
 * matches `npm run format` and the two never fight over a file.
 */
async function format(file, markdown) {
  const options = await prettier.resolveConfig(file);
  return prettier.format(markdown, { ...options, filepath: file });
}

/** Reads a file with LF endings and remembers its original line ending. */
function read(file) {
  const raw = readFileSync(file, "utf8");
  return {
    text: raw.replace(/\r\n/g, "\n"),
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
  };
}

/** Renders a plan's progress block and its index entry from its tickets. */
async function syncPlan({ feature, name }) {
  const file = join(planRoot, feature, name);
  const { text, eol } = read(file);
  const tickets = parseTickets(text);
  const block = renderPlanBlock(tickets);
  const next = await format(
    file,
    upsertBlock(text, PLAN_START, PLAN_END, block, isTitle),
  );
  const title = /^# (.+)$/m.exec(text)?.[1] ?? name;
  return {
    file,
    before: text,
    after: next,
    eol,
    entry: { title, feature, file: posix.join(feature, name), tickets },
  };
}

/** Places a new block directly under the document title. */
function isTitle(line) {
  return line.startsWith("# ");
}

/** Places a new index block under the plan list heading. */
function isPlanListHeading(line) {
  return line === "## Detailed Plans";
}

/**
 * Lists plans feature folder by feature folder. A plan left at the root is an
 * error, so plans cannot pile up there again.
 */
function listPlans() {
  const entries = readdirSync(planRoot, { withFileTypes: true });
  const strays = entries.filter(
    (entry) => entry.isFile() && PLAN_FILE.test(entry.name),
  );
  if (strays.length > 0)
    throw new Error(
      `Move these plans into a feature folder such as 001-mvp/: ${strays
        .map((entry) => entry.name)
        .join(", ")}`,
    );
  return entries
    .filter((entry) => entry.isDirectory() && FEATURE_FOLDER.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .flatMap((feature) =>
      readdirSync(join(planRoot, feature))
        .filter((name) => PLAN_FILE.test(name))
        .sort()
        .map((name) => ({ feature, name })),
    );
}

/** Writes or checks every generated block, reporting each stale file. */
async function main() {
  const check = process.argv.includes("--check");
  const results = await Promise.all(listPlans().map(syncPlan));

  const index = read(indexFile);
  const indexBlock = renderIndexBlock(results.map((result) => result.entry));
  const indexText = upsertBlock(
    index.text,
    INDEX_START,
    INDEX_END,
    indexBlock,
    isPlanListHeading,
  );
  results.push({
    file: indexFile,
    before: index.text,
    after: await format(indexFile, indexText),
    eol: index.eol,
  });

  const stale = results.filter((result) => result.before !== result.after);
  if (check) {
    for (const result of stale)
      console.error(`Stale plan status: ${result.file}`);
    if (stale.length > 0) {
      console.error("Run `npm run plan:status` and commit the result.");
      process.exitCode = 1;
    }
    return;
  }
  for (const result of stale)
    writeFileSync(result.file, result.after.replace(/\n/g, result.eol));
  console.log(
    `Updated ${stale.length} of ${results.length} plan status file(s).`,
  );
}

await main();
