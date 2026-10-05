// The child-process port media (ffprobe) and signal (FFmpeg) spawn through.
export type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "./child-process/contracts.js";
export { NodeProcessSpawner } from "./child-process/node-process-spawner.js";

// Lifecycle helpers both consumers share, so termination and diagnostics stay consistent.
export {
  OutputTail,
  STDERR_TAIL_LIMIT_BYTES,
} from "./child-process/output-tail.js";
export {
  sanitizeDiagnosticText,
  summarizeStderr,
  truncateDiagnosticText,
} from "./child-process/stderr-summary.js";
export { terminateProcess } from "./child-process/terminate-process.js";

// Integer option checks media, signal, and the server apply to timeouts and
// limits, shared here so one rule and one message never drift between packages.
export {
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "./options/safe-integer-option.js";
