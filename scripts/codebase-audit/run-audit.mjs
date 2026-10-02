// Checks the repository against the mechanical rules in AGENTS.md.
//
// Usage:
//   node scripts/codebase-audit/run-audit.mjs                 Report findings; always exits 0.
//   node scripts/codebase-audit/run-audit.mjs --strict        Exit 1 when any error remains.
//   node scripts/codebase-audit/run-audit.mjs --json          Print JSON for agents and tooling.
//   node scripts/codebase-audit/run-audit.mjs --no-duplicates Skip the jscpd pass.
//
// Judgment calls the rules cannot make are the codebase-audit skill's job.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDuplicates } from "./duplicate-code.mjs";
import { applyExceptions, loadExceptions } from "./exceptions.mjs";
import { loadInventory } from "./inventory.mjs";
import { checkLayout } from "./layout-rules.mjs";
import { checkModules } from "./module-rules.mjs";
import { formatJson, formatText, sortFindings } from "./report.mjs";

const auditDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(auditDir, "..", "..");
const args = new Set(process.argv.slice(2));

const { excludedPaths, exceptions } = loadExceptions(
  join(auditDir, "audit-exceptions.json"),
);
const inventory = loadInventory(repoRoot, { excludedPaths });
const findings = [
  ...checkLayout(inventory),
  ...checkModules(inventory),
  ...(args.has("--no-duplicates") ? [] : checkDuplicates(repoRoot, inventory)),
];
const { active, excepted } = applyExceptions(findings, exceptions);
const result = {
  active: sortFindings(active),
  excepted: sortFindings(excepted),
};

console.log(args.has("--json") ? formatJson(result) : formatText(result));

if (args.has("--strict") && active.some((f) => f.severity === "error")) {
  process.exitCode = 1;
}
