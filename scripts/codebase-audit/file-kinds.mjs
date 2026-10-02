// Classifies inventory files by the roles AGENTS.md gives them, so every rule
// agrees on what counts as a test, a test double, or a counted source file.

const TEST_FILE = /\.test\.tsx?$/;
const ENTRY_POINT = /^(index|main|app|errors)\.tsx?$|^create-[\w-]+\.ts$/;

/** Test suites, including scenario-named ones such as `x.scenarios.test.ts`. */
export function isTestFile(file) {
  return TEST_FILE.test(file.srcPath);
}

/** Files in the workspace's single `src/testing/` folder. */
export function isTestingFile(file) {
  return file.srcPath.startsWith("testing/");
}

/** Shipped code: neither a test suite nor a test double or fixture. */
export function isProductionFile(file) {
  return !isTestFile(file) && !isTestingFile(file);
}

/** Source files the grouping rule counts: tests and `contracts.ts` do not count. */
export function isCountedSourceFile(file) {
  return isProductionFile(file) && baseName(file.srcPath) !== "contracts.ts";
}

/** Whether a `src/`-root file name is an allowed entry point. */
export function isEntryPointName(name) {
  return ENTRY_POINT.test(name);
}

/**
 * Whether a `src/`-root test suite sits beside an entry point, such as
 * `create-x.scenarios.test.ts` beside `create-x.ts`.
 */
export function isEntryPointTestName(name) {
  const subject = name.replace(/(\.[\w-]+)?\.test\.(tsx?)$/, ".$2");
  return subject !== name && isEntryPointName(subject);
}

/** The directory segments of a `src/`-relative path. */
export function folderSegments(srcPath) {
  return srcPath.split("/").slice(0, -1);
}

/** The final path segment. */
export function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}
