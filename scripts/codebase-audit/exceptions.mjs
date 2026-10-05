// Applies the recorded, reasoned exceptions in audit-exceptions.json so an
// accepted deviation is decided once and never re-reported.

import { readFileSync } from "node:fs";

/** Reads the exceptions file; every exception must say why and on what authority. */
export function loadExceptions(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  for (const exception of config.exceptions ?? []) {
    if (!exception.rule || !exception.files?.length || !exception.reason) {
      throw new Error(
        `Exception needs rule, files, and reason: ${JSON.stringify(exception)}`,
      );
    }
  }
  return {
    excludedPaths: config.excludedPaths ?? [],
    exceptions: config.exceptions ?? [],
  };
}

/** Whether a path is one of an exception's paths or under one of its folders. */
function covers(exceptionPath, path) {
  return exceptionPath.endsWith("/")
    ? path.startsWith(exceptionPath)
    : path === exceptionPath;
}

/** Whether an exception covers every file a finding names. */
export function matches(exception, finding) {
  return (
    exception.rule === finding.rule &&
    (exception.symbol === undefined || exception.symbol === finding.symbol) &&
    finding.files.every((path) =>
      exception.files.some((exceptionPath) => covers(exceptionPath, path)),
    )
  );
}

/**
 * Splits findings into active and excepted, and reports exceptions that no
 * longer match anything so the file cannot silently go stale.
 */
export function applyExceptions(findings, exceptions) {
  const used = new Set();
  const active = [];
  const excepted = [];
  for (const finding of findings) {
    const exception = exceptions.find((candidate) =>
      matches(candidate, finding),
    );
    if (exception === undefined) {
      active.push(finding);
    } else {
      used.add(exception);
      excepted.push({ ...finding, reason: exception.reason });
    }
  }
  const stale = exceptions
    .filter((exception) => !used.has(exception))
    .map((exception) => ({
      rule: "stale-exception",
      severity: "review",
      files: exception.files,
      message: `exception for "${exception.rule}" matches nothing; remove it from audit-exceptions.json`,
    }));
  return { active: [...active, ...stale], excepted };
}
