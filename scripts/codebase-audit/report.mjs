// Formats audit results for people (grouped text) and for agents (JSON).

const SEVERITY_ORDER = ["error", "review"];

/** Orders findings by severity, then rule, then file, so output is stable run to run. */
export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.rule.localeCompare(b.rule) ||
      a.files[0].localeCompare(b.files[0]) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
}

/** Renders findings grouped by severity and rule, with a closing summary. */
export function formatText({ active, excepted }) {
  const lines = [];
  for (const severity of SEVERITY_ORDER) {
    const group = active.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`\n${severity.toUpperCase()} (${group.length})`);
    let rule;
    for (const finding of group) {
      if (finding.rule !== rule) {
        rule = finding.rule;
        lines.push(`  ${rule}`);
      }
      const location =
        finding.line === undefined
          ? finding.files[0]
          : `${finding.files[0]}:${finding.line}`;
      lines.push(`    ${location}`);
      lines.push(`      ${finding.message}`);
    }
  }
  const errors = active.filter((finding) => finding.severity === "error");
  lines.push(
    `\n${errors.length} error(s), ${active.length - errors.length} review item(s), ${excepted.length} excepted`,
  );
  return lines.join("\n");
}

/** Renders the full result as JSON for agents and tooling. */
export function formatJson({ active, excepted }) {
  return JSON.stringify({ findings: active, excepted }, null, 2);
}
